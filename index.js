const { ImapFlow } = require('imapflow');
const { v4: uuidv4 } = require("uuid")

module.exports = {
	imapFactory: (config, sinceDate, beforeDate) => {
		// Create one IMAP client instance per factory call.
		const client = new ImapFlow({
			host: config.credentials.host,
			port: config.credentials.port,
			secure: config.credentials.tls,
			tls: config.credentials.tlsOptions,
			logger: false,
			auth: {
				user: config.credentials.user,
				pass: config.credentials.password,
			},
		});
		return {
			client: client,
			async connect() {
				await this.client.connect();
			},

			async openBox() {
				await this.client.mailboxOpen(config.mailBoxFolder);
			},

			async getSeqNos() {
				// Search returns sequence numbers from the currently opened mailbox.
				// Note: IMAP "seen: true" means already-read messages.
				let seqNos = await client.search({
					seen: config.onlyFetchUnreadEmails,
					since: sinceDate,
					before: beforeDate,
				});
				return seqNos;
			},

			async getAttachmentData(uid, part) {
				// Download returns a readable stream as "content".
				let { content } = await client.download(uid, part, { uid: true });
				return content;
			},

			async moveEmails(seqNos, srcMailBox, destMailBox) {
				// Select source mailbox
				let lock = await client.getMailboxLock(srcMailBox);
				try {
					// Move messages to another mailbox
					await client.messageMove(seqNos, destMailBox);
				} finally {
					// Always release lock if it was acquired.
					lock.release();
				}
			},

			async processEmails(seqNos, messageConcurrency, processorFunc) {
				if (!Array.isArray(seqNos) || seqNos.length === 0) {
					return [];
				}

				// Worker-pool concurrency: fetch/process up to N messages in parallel.
				const concurrency = Math.max(1, Number(messageConcurrency) || 1);
				const workerCount = Math.min(concurrency, seqNos.length);
				const results = new Array(seqNos.length);
				let nextIndex = 0;

				const worker = async () => {
					while (true) {
						// Each worker claims the next sequence number index.
						const currentIndex = nextIndex++;
						if (currentIndex >= seqNos.length) {
							return;
						}

						const seqNo = seqNos[currentIndex];
						// Fetch only fields required by processor and attachment parsing.
						const message = await client.fetchOne(seqNo, {
							envelope: true,
							bodyStructure: true,
						});

						if (!message) {
							// Keep array alignment; removed before return.
							// fetchOne can return false for missing/expunged sequence numbers.
							results[currentIndex] = null;
							continue;
						}

						// Parse MIME body structure to collect attachment parts.
						const attachments = message.bodyStructure
							? findAttachments(message.bodyStructure)
							: [];

						// Caller-provided processor may do I/O (download, save, DB write, etc.).
						results[currentIndex] = await processorFunc(message, attachments, seqNo);
					}
				};

				await Promise.all(Array.from({ length: workerCount }, () => worker()));
				// Return only successfully fetched messages.
				// If any worker throws, Promise.all rejects and caller handles the error.
				return results.filter((x) => x !== null);
			},
		};
	},
};

function extensionRegex(str) {
	// Keep only alpha chars in file extension for safer generated names.
	let ext = /(?:\.([^.]+))?$/.exec(str)[1] || '';
	return ext.replace(/[^A-Za-z]+/, '');
}

function findAttachments(node, path = []) {
	let attachments = [];

	// Treat parts with attachment-like disposition or filename metadata as files.
	if (
		((node.disposition === 'attachment' ||
			(node.dispositionParameters && node.dispositionParameters.filename)) &&
			node.disposition === 'inline') ||
		(node.dispositionParameters && node.dispositionParameters.filename) ||
		(node.parameters && node.parameters.name)
	) {
		let attachmentFilename =
			node.dispositionParameters?.filename || node.parameters?.name || 'attachment';
		if (attachmentFilename.indexOf('/') > -1) {
			log.d("'/' in filename", attachmentFilename);
			let split = attachmentFilename.split('/');
			// if filename has '/' then split on it and take last string as filename
			attachmentFilename = split.pop();
		}

		let uid = uuidv4();
		// Use UUID filenames to avoid collisions when source filenames repeat.
		let filename = uid;
		let extension = extensionRegex(
			attachmentFilename
		).toLowerCase();
		if (extension != '') filename += '.' + extension;

		attachments.push({
			// MIME part numbering (e.g. 2, 1.2, 3.1.1).
			part: path.length ? path.join('.') : '1',
			type: `${node.type}/${node.subtype || 'octet-stream'}`,
			encoding: node.encoding,
			size: node.size,
			filename: filename,
			originalFilename: attachmentFilename,
		});
	}

	if (node.childNodes) {
		// Traverse multipart children depth-first and merge matches.
		node.childNodes.forEach((child, i) => {
			// IMAP part indices are 1-based in each multipart level.
			attachments.push(...findAttachments(child, [...path, i + 1]));
		});
	}

	return attachments;
}

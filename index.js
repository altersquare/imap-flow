const { ImapFlow } = require('imapflow');
const { v4: uuidv4 } = require("uuid")

module.exports = {
	imapFactory: (config, sinceDate, beforeDate) => {
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
				let seqNos = await client.search({
					seen: config.onlyFetchUnreadEmails,
					since: sinceDate,
					before: beforeDate,
				});
				return seqNos;
			},

			async getAttachmentData(uid, part) {
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
					lock.release();
				}
			},

			async processEmails(seqNos, messageConcurrency, processorFunc) {
				if (!Array.isArray(seqNos) || seqNos.length === 0) {
					return [];
				}

				const concurrency = Math.max(1, Number(messageConcurrency) || 1);
				const workerCount = Math.min(concurrency, seqNos.length);
				const results = new Array(seqNos.length);
				let nextIndex = 0;

				const worker = async () => {
					while (true) {
						const currentIndex = nextIndex++;
						if (currentIndex >= seqNos.length) {
							return;
						}

						const seqNo = seqNos[currentIndex];
						const message = await client.fetchOne(seqNo, {
							envelope: true,
							bodyStructure: true,
						});

						if (!message) {
							results[currentIndex] = null;
							continue;
						}

						const attachments = message.bodyStructure
							? findAttachments(message.bodyStructure)
							: [];

						results[currentIndex] = await processorFunc(message, attachments, seqNo);
					}
				};

				await Promise.all(Array.from({ length: workerCount }, () => worker()));
				return results.filter((x) => x !== null);
			},
		};
	},
};

function extensionRegex(str) {
	let ext = /(?:\.([^.]+))?$/.exec(str)[1] || '';
	return ext.replace(/[^A-Za-z]+/, '');
}

function findAttachments(node, path = []) {
	let attachments = [];

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
		let filename = uid;
		let extension = extensionRegex(
			attachmentFilename
		).toLowerCase();
		if (extension != '') filename += '.' + extension;

		attachments.push({
			part: path.length ? path.join('.') : '1',
			type: `${node.type}/${node.subtype || 'octet-stream'}`,
			encoding: node.encoding,
			size: node.size,
			filename: filename,
			originalFilename: attachmentFilename,
		});
	}

	if (node.childNodes) {
		node.childNodes.forEach((child, i) => {
			attachments.push(...findAttachments(child, [...path, i + 1]));
		});
	}

	return attachments;
}

require('dotenv').config({ quiet: true });

const { pipeline } = require('stream/promises');
const fs = require('fs');

const config = require('./config.example');

const lib = require('./index');

// Build IMAP helper bound to a date window for message search.
const imap = lib.imapFactory(config, new Date('2026-04-01'), new Date('2026-04-02'));

async function main() {
	// Establish TCP/TLS + authenticated IMAP session.
	console.log('Connecting...');
	await imap.connect();
	console.log('Connected.');

	// Select the configured mailbox before search/fetch operations.
	console.log('Opening...');
	await imap.openBox();
	console.log('Opened.');

	// Retrieve sequence numbers that match search filters in factory config.
	console.log('Fetching seq nos');
	let seqNos = await imap.getSeqNos();
	console.log('Fetched.', seqNos.length);

	// Process messages concurrently (up to 8 workers).
	await imap.processEmails(seqNos, 8, async function (message, attachments, seqNo) {
		// Envelope includes subject/from/to/date, useful for quick logging.
		console.log(message.envelope);
		for (let attch of attachments) {
			// Write each attachment stream to disk with backpressure/error handling.
			let ws = fs.createWriteStream(`./attachments/${attch.filename}`);
			let rs = await imap.getAttachmentData(message.uid, attch.part);
			await pipeline(rs, ws);
		}
	});
}

// Bubble any unhandled async error to stderr.
main().catch(console.error);

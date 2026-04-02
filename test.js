require('dotenv').config({ quiet: true });

const { pipeline } = require('stream/promises');
const fs = require('fs');

const config = require('./config.example');

const lib = require('./index');

const imap = lib.imapFactory(config, new Date('2026-04-01'), new Date('2026-04-02'));

async function main() {
	console.log('Connecting...');
	await imap.connect();
	console.log('Connected.');

	console.log('Opening...');
	await imap.openBox();
	console.log('Opened.');

	console.log('Fetching seq nos');
	let seqNos = await imap.getSeqNos();
	console.log('Fetched.', seqNos.length);

	await imap.processEmails(seqNos, 8, async function (message, attachments, seqNo) {
		console.log(message.envelope);
		for (let attch of attachments) {
			let ws = fs.createWriteStream(`./attachments/${attch.filename}`);
			let rs = await imap.getAttachmentData(message.uid, attch.part);
			await pipeline(rs, ws);
		}
	});
}

main().catch(console.error);

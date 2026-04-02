module.exports = {
	mailBoxFolder: process.env.IMAP_MAIL_BOX_FOLDER,
	moveEmails: process.env.IMAP_MOVE_EMAILS == "true",
	moveMailBoxName: process.env.IMAP_MOVE_EMAIL_FOLDER,
	moveNoAttachmentEmails: process.env.IMAP_MOVE_NO_ATTACHMENT_EMAILS == "true",
	noEmailAttachmentBoxName: process.env.IMAP_NO_ATTACHMENT_FOLDER,
	onlyFetchUnreadEmails: process.env.IMAP_ONLY_FETCH_UNREAD_EMAILS == "true",
	markEmailAsReadAfterFetching: process.env.IMAP_MARK_EMAIL_AS_READ_AFTER_FETCHING == "true",
	credentials: {
		user: process.env.IMAP_USERNAME,
		password: process.env.IMAP_PASSWORD,
		host: process.env.IMAP_HOST,
		port: Number(process.env.IMAP_PORT),
		tls: process.env.IMAP_TLS_ENABLED == "true",
		tlsOptions: {
			rejectUnauthorized: false,
		},
	},
}

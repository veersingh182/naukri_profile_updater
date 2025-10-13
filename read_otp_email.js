const { google } = require('googleapis');

// Initialize OAuth2 client
const oAuth2Client = new google.auth.OAuth2(
    process.env.GMAIL_CLIENT_ID,
    process.env.GMAIL_CLIENT_SECRET,
);
oAuth2Client.setCredentials({
    refresh_token: process.env.GMAIL_REFRESH_TOKEN
});

// Create Gmail API client
const gmail = google.gmail({ version: 'v1', auth: oAuth2Client });

// Example: find unread OTP email from a specific sender
async function getLatestOtpEmail(sender) {
    try {

        // console.log(process.env.GMAIL_CLIENT_ID, process.env.GMAIL_CLIENT_SECRET, process.env.GMAIL_REFRESH_TOKEN);
        // 1️⃣ Search for unread email from given sender
        const listRes = await gmail.users.messages.list({
            userId: 'me',
            // q: `is:unread from:${sender}`,
            q: `in:inbox is:unread from:${sender} after:${Math.floor(Date.now() / 1000) - 60} subject:"Your OTP for logging in Naukri account"`,
            maxResults: 1
        });
        console.log("here", listRes.data)
        const messages = listRes.data.messages;
        if (!messages || messages.length === 0) {
            console.log('No unread OTP emails found.');
            return null;
        }

        const messageId = messages[0].id;

        console.log('Found message ID:', messageId);

        // 2️⃣ Fetch full message
        const msgRes = await gmail.users.messages.get({
            userId: 'me',
            id: messageId,
        });

        // console.log('Full message data:', msgRes.data);
        console.log('Full message payload parts:', msgRes.data.payload.parts?.[0]?.parts);
        console.log('Full message payload data:', msgRes.data.payload.body);
        // 3️⃣ Decode email body (handle base64)
        const bodyData =
            msgRes.data.payload.parts?.[0]?.parts?.[0]?.body?.data ||
            msgRes.data.payload.parts?.[0]?.body?.data ||
            msgRes.data.payload.body?.data;

        console.log('Encoded Body Data:', bodyData);

        const emailBody = Buffer.from(bodyData, 'base64').toString('utf-8');

        console.log('Email Body:', emailBody);

        // 4️⃣ Extract OTP (simple regex: 4-8 digits)
        const otpMatch = emailBody.match(/<td[^>]*>(\d{6})<\/td>/);
        const otp = otpMatch ? otpMatch[1] : null;

        console.log('OTP:', otp || 'Not found');
        return otp;
    } catch (err) {
        console.error('Error reading OTP email:', err.message);
        return null;
    }
}

// Example usage:
// getLatestOtpEmail('no-reply@naukri.com');
// getLatestOtpEmail('info@naukri.com');


module.exports = getLatestOtpEmail;
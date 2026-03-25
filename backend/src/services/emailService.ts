import nodemailer from 'nodemailer';

export const sendEmail = async (
  to: string,
  subject: string,
  message: string,
  htmlMessage?: string,
  retryCount = 1
): Promise<void> => {
  try {
    const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS } = process.env;

    // If no credentials, just skip gracefully without crashing
    if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
      console.warn(`[EmailService] Missing SMTP config. Skipping email.`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: Number(EMAIL_PORT) || 587,
      secure: Number(EMAIL_PORT) === 465,
      auth: {
        user: EMAIL_USER,
        pass: EMAIL_PASS,
      },
    });

    await transporter.sendMail({
      from: `"VideoAutomation" <no-reply@${EMAIL_HOST}>`,
      to,
      subject,
      text: message,
      ...(htmlMessage ? { html: htmlMessage } : {}),
    });

    console.log(`[EmailService] Email sent successfully.`);
  } catch (error: any) {
    if (retryCount > 0) {
      console.warn(`[EmailService] Retrying email...`);
      return sendEmail(to, subject, message, htmlMessage, retryCount - 1);
    }
    console.error(`[EmailService] Failed to send email:`, error.message);
  }
};

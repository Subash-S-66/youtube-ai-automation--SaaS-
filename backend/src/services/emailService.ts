import nodemailer from 'nodemailer';

export const sendEmail = async (to: string, subject: string, message: string): Promise<void> => {
  try {
    const { EMAIL_HOST, EMAIL_PORT, EMAIL_USER, EMAIL_PASS } = process.env;

    // If no credentials, just skip gracefully without crashing
    if (!EMAIL_HOST || !EMAIL_USER || !EMAIL_PASS) {
      console.warn(`[EmailService] Missing SMTP config. Skipping email to ${to}`);
      return;
    }

    const transporter = nodemailer.createTransport({
      host: EMAIL_HOST,
      port: Number(EMAIL_PORT) || 587,
      secure: Number(EMAIL_PORT) === 465 ? true : false,
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
    });

    console.log(`[EmailService] Email sent successfully to ${to}`);
  } catch (error: any) {
    console.error(`[EmailService] Failed to send email to ${to}:`, error.message);
  }
};

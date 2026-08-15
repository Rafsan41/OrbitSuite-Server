import nodemailer, { type Transporter } from "nodemailer";
import { env, requireSmtpEnv } from "../config/env.js";

let transporter: Transporter | null = null;

const isConfigured = () => Boolean(env.SMTP_HOST && env.SMTP_PORT);

const getTransporter = (): Transporter => {
    if (!transporter) {
        const smtp = requireSmtpEnv();

        transporter = nodemailer.createTransport({
            host: smtp.host,
            port: smtp.port,
            // Mailtrap and most sandboxes use STARTTLS on non-465 ports.
            secure: smtp.port === 465,
            auth: smtp.user ? { user: smtp.user, pass: smtp.password } : undefined,
        });
    }

    return transporter;
};

export type MailMessage = {
    to: string;
    subject: string;
    html: string;
    text: string;
};

/**
 * Sends an email, or logs it when SMTP is not configured.
 *
 * Never throws. Notifications are a side effect of a business action, not part
 * of it — a failed invite email must not fail the invite, and a failed receipt
 * must not fail a payment that Stripe has already taken.
 */
export const sendMail = async (message: MailMessage): Promise<boolean> => {
    if (!isConfigured()) {
        console.log(`[mail:skipped] to=${message.to} subject="${message.subject}"`);
        return false;
    }

    try {
        await getTransporter().sendMail({
            from: env.MAIL_FROM,
            to: message.to,
            subject: message.subject,
            text: message.text,
            html: message.html,
        });

        console.log(`[mail:sent] to=${message.to} subject="${message.subject}"`);
        return true;
    } catch (error) {
        console.error(`[mail:failed] to=${message.to}`, error);
        return false;
    }
};

/**
 * Dispatches without awaiting, for callers that must not wait on SMTP.
 * Errors are already swallowed by sendMail; this only detaches the timing.
 */
export const sendMailDetached = (message: MailMessage): void => {
    void sendMail(message);
};

// Shared shell so every notification looks like it came from the same product.
export const renderLayout = (heading: string, bodyHtml: string): string => `
<!doctype html>
<html>
  <body style="margin:0;padding:24px;background:#f4f5f7;font-family:system-ui,-apple-system,'Segoe UI',sans-serif;color:#1a1a1a;">
    <table role="presentation" style="max-width:520px;margin:0 auto;background:#ffffff;border-radius:8px;padding:32px;">
      <tr><td>
        <p style="margin:0 0 24px;font-size:13px;letter-spacing:.08em;text-transform:uppercase;color:#6b7280;">OrbitSuite</p>
        <h1 style="margin:0 0 16px;font-size:20px;line-height:1.3;">${heading}</h1>
        ${bodyHtml}
        <p style="margin:32px 0 0;font-size:12px;color:#9ca3af;">You are receiving this because you belong to an organization on OrbitSuite.</p>
      </td></tr>
    </table>
  </body>
</html>`;

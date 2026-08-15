import { renderLayout, sendMailDetached } from "../../lib/mailer.js";
import { env } from "../../config/env.js";

const money = (cents: number, currency = "usd") =>
    new Intl.NumberFormat("en-US", { style: "currency", currency: currency.toUpperCase() }).format(
        cents / 100,
    );

const button = (href: string, label: string) =>
    `<p style="margin:24px 0;"><a href="${href}" style="display:inline-block;background:#1a1a1a;color:#ffffff;text-decoration:none;padding:12px 20px;border-radius:6px;font-size:14px;">${label}</a></p>`;

const paragraph = (text: string) =>
    `<p style="margin:0 0 12px;font-size:15px;line-height:1.5;">${text}</p>`;

/** A member has been invited and must set a password to activate their account. */
const memberInvited = (input: {
    to: string;
    inviteeName: string;
    organizationName: string;
    invitedBy: string;
    token: string;
}) => {
    const link = `${env.CLIENT_URL}/accept-invite?token=${input.token}`;

    sendMailDetached({
        to: input.to,
        subject: `You have been invited to join ${input.organizationName} on OrbitSuite`,
        text: `Hi ${input.inviteeName}, ${input.invitedBy} invited you to join ${input.organizationName} on OrbitSuite. Accept your invitation: ${link} (expires in 7 days)`,
        html: renderLayout(
            `You have been invited to join ${input.organizationName}`,
            paragraph(`Hi ${input.inviteeName},`) +
                paragraph(
                    `${input.invitedBy} has invited you to join <strong>${input.organizationName}</strong> on OrbitSuite. Set a password to activate your account.`,
                ) +
                button(link, "Accept invitation") +
                paragraph(
                    `<span style="color:#6b7280;font-size:13px;">This invitation expires in 7 days.</span>`,
                ),
        ),
    });
};

const paymentSucceeded = (input: {
    to: string;
    organizationName: string;
    planName: string;
    amountCents: number;
    currency?: string;
    periodEnd?: Date | null;
}) => {
    const amount = money(input.amountCents, input.currency);

    sendMailDetached({
        to: input.to,
        subject: `Payment received — ${amount}`,
        text: `We received your ${amount} payment for the ${input.planName} plan. ${input.organizationName} is active.`,
        html: renderLayout(
            "Payment received",
            paragraph(
                `We have received your payment of <strong>${amount}</strong> for the <strong>${input.planName}</strong> plan.`,
            ) +
                paragraph(`<strong>${input.organizationName}</strong> is now active.`) +
                (input.periodEnd
                    ? paragraph(
                          `<span style="color:#6b7280;font-size:13px;">Next renewal: ${input.periodEnd.toDateString()}</span>`,
                      )
                    : "") +
                button(`${env.CLIENT_URL}/org/billing`, "View billing history"),
        ),
    });
};

const paymentFailed = (input: {
    to: string;
    organizationName: string;
    amountCents: number;
    currency?: string;
}) => {
    sendMailDetached({
        to: input.to,
        subject: "Payment failed — action required",
        text: `We could not process your ${money(input.amountCents, input.currency)} payment for ${input.organizationName}. Please update your payment method to restore access.`,
        html: renderLayout(
            "We could not process your payment",
            paragraph(
                `Your payment of <strong>${money(input.amountCents, input.currency)}</strong> for <strong>${input.organizationName}</strong> was declined.`,
            ) +
                paragraph("Access is limited until a successful payment is received.") +
                button(`${env.CLIENT_URL}/org/billing`, "Update payment method"),
        ),
    });
};

/** Covers upgrade, downgrade and cancellation — one event, three shapes. */
const subscriptionChanged = (input: {
    to: string;
    organizationName: string;
    change: "upgrade" | "downgrade" | "cancelled";
    fromPlan?: string;
    toPlan?: string;
}) => {
    const headings = {
        upgrade: "Your plan has been upgraded",
        downgrade: "Your plan has been changed",
        cancelled: "Your subscription has been cancelled",
    } as const;

    const body =
        input.change === "cancelled"
            ? paragraph(
                  `The subscription for <strong>${input.organizationName}</strong> has been cancelled. You will not be charged again.`,
              )
            : paragraph(
                  `<strong>${input.organizationName}</strong> has moved from <strong>${input.fromPlan}</strong> to <strong>${input.toPlan}</strong>. Any difference is prorated on your next invoice.`,
              );

    sendMailDetached({
        to: input.to,
        subject: headings[input.change],
        text: `${headings[input.change]} — ${input.organizationName}`,
        html: renderLayout(
            headings[input.change],
            body + button(`${env.CLIENT_URL}/org/subscription`, "View subscription"),
        ),
    });
};

const subscriptionExpiringSoon = (input: {
    to: string;
    organizationName: string;
    planName: string;
    daysRemaining: number;
    renewsOn: Date;
}) => {
    sendMailDetached({
        to: input.to,
        subject: `Your ${input.planName} plan renews in ${input.daysRemaining} days`,
        text: `The ${input.planName} plan for ${input.organizationName} renews on ${input.renewsOn.toDateString()}.`,
        html: renderLayout(
            `Your plan renews in ${input.daysRemaining} days`,
            paragraph(
                `The <strong>${input.planName}</strong> plan for <strong>${input.organizationName}</strong> renews on <strong>${input.renewsOn.toDateString()}</strong>.`,
            ) +
                paragraph("No action is needed if your payment details are up to date.") +
                button(`${env.CLIENT_URL}/org/subscription`, "Manage subscription"),
        ),
    });
};

export const NotificationService = {
    memberInvited,
    paymentSucceeded,
    paymentFailed,
    subscriptionChanged,
    subscriptionExpiringSoon,
};

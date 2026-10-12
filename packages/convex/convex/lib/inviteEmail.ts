import type { EmailMessage } from "./email";

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function layout(heading: string, paragraphs: readonly string[], action?: string): string {
  const body = paragraphs
    .map((text) => `<p style="margin:0 0 14px;line-height:1.5">${text}</p>`)
    .join("");
  return `<div style="font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;max-width:480px;margin:0 auto;padding:24px;color:#1b1b1f"><h1 style="font-size:20px;margin:0 0 16px">${escapeHtml(heading)}</h1>${body}${action ?? ""}</div>`;
}

function button(href: string, label: string): string {
  return `<p style="margin:20px 0"><a href="${escapeHtml(href)}" style="background:#5b5bd6;color:#fff;text-decoration:none;padding:10px 18px;border-radius:8px;display:inline-block">${escapeHtml(label)}</a></p>`;
}

function expiryLine(expiresAt: number | undefined): string {
  if (expiresAt === undefined) {
    return "This link does not expire, and works once.";
  }
  const date = new Date(expiresAt).toUTCString();
  return `This link works once and expires on ${date}.`;
}

export interface InviteEmailInput {
  readonly workspaceName: string;
  readonly invitedBy: string;
  readonly link: string;
  readonly expiresAt?: number | undefined;
}

/** The invitation sent to one address; the link inside is single-use. */
export function inviteEmail(input: InviteEmailInput): Omit<EmailMessage, "to"> {
  const expiry = expiryLine(input.expiresAt);
  return {
    subject: `You're invited to ${input.workspaceName}`,
    text: `${input.invitedBy} invited you to join ${input.workspaceName} on Aulora.\n\n${input.link}\n\n${expiry}\nIf you were not expecting this, you can ignore this email.`,
    html: layout(
      `Join ${input.workspaceName}`,
      [
        `${escapeHtml(input.invitedBy)} invited you to join <strong>${escapeHtml(input.workspaceName)}</strong> on Aulora.`,
        escapeHtml(expiry),
      ],
      button(input.link, "Accept invitation"),
    ),
  };
}

export interface JoinCodeEmailInput {
  readonly workspaceName: string;
  readonly code: string;
  readonly minutes: number;
}

/** The six-digit code that proves a mailbox before an allowlisted join. */
export function joinCodeEmail(input: JoinCodeEmailInput): Omit<EmailMessage, "to"> {
  return {
    subject: `${input.code} is your ${input.workspaceName} verification code`,
    text: `Your code to join ${input.workspaceName} is ${input.code}.\n\nIt expires in ${input.minutes} minutes. If you did not ask for it, you can ignore this email.`,
    html: layout(`Your verification code`, [
      `Use this code to join <strong>${escapeHtml(input.workspaceName)}</strong>:`,
      `<span style="font-size:28px;letter-spacing:6px;font-weight:600">${escapeHtml(input.code)}</span>`,
      `It expires in ${input.minutes} minutes. If you did not ask for it, you can ignore this email.`,
    ]),
  };
}

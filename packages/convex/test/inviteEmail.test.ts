import { describe, expect, it } from "vitest";
import { inviteEmail, joinCodeEmail } from "../convex/lib/inviteEmail";

describe("inviteEmail", () => {
  it("escapes the workspace and inviter names in the HTML body only", () => {
    const message = inviteEmail({
      workspaceName: '<Team & "Co">',
      invitedBy: 'O"Hara <ops>',
      link: "https://app.example/join?code=abc&next=<home>",
      expiresAt: undefined,
    });

    expect(message.html).toContain("Join &lt;Team &amp; &quot;Co&quot;&gt;");
    expect(message.html).toContain(
      "O&quot;Hara &lt;ops&gt; invited you to join <strong>&lt;Team &amp; &quot;Co&quot;&gt;</strong>",
    );
    expect(message.html).toContain(
      'href="https://app.example/join?code=abc&amp;next=&lt;home&gt;"',
    );

    expect(message.text).toContain('O"Hara <ops> invited you to join <Team & "Co"> on Aulora.');
    expect(message.text).toContain("https://app.example/join?code=abc&next=<home>");
  });

  it("says a never-expiring invite works once", () => {
    const message = inviteEmail({
      workspaceName: "Aulora",
      invitedBy: "Ada",
      link: "https://app.example/join?code=abc",
      expiresAt: undefined,
    });

    expect(message.text).toContain("This link does not expire, and works once.");
    expect(message.html).toContain("This link does not expire, and works once.");
  });

  it("prints the expiry date when the invite expires", () => {
    const expiresAt = Date.UTC(2026, 9, 20, 12, 0, 0);
    const message = inviteEmail({
      workspaceName: "Aulora",
      invitedBy: "Ada",
      link: "https://app.example/join?code=abc",
      expiresAt,
    });

    const expected = `This link works once and expires on ${new Date(expiresAt).toUTCString()}.`;
    expect(message.text).toContain(expected);
    expect(message.html).toContain(expected);
    expect(message.subject).toBe("You're invited to Aulora");
  });
});

describe("joinCodeEmail", () => {
  it("shows the code and its lifetime", () => {
    const message = joinCodeEmail({ workspaceName: "Aulora", code: "123456", minutes: 10 });

    expect(message.subject).toBe("123456 is your Aulora verification code");
    expect(message.text).toContain("Your code to join Aulora is 123456.");
    expect(message.text).toContain("It expires in 10 minutes.");
    expect(message.html).toContain(
      '<span style="font-size:28px;letter-spacing:6px;font-weight:600">123456</span>',
    );
  });

  it("escapes an unexpected workspace name", () => {
    const message = joinCodeEmail({ workspaceName: "<A&B>", code: "123456", minutes: 5 });

    expect(message.html).toContain("<strong>&lt;A&amp;B&gt;</strong>");
  });
});

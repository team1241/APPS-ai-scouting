import type { Metadata } from "next";

export const metadata: Metadata = { title: "Privacy" };

// Matches docs/privacy-notice.md; update both when the notice changes.
const paragraphs = [
  "This service is for Canadian teams with high-school-age scouts. You submit scouting notes through your team's Telegram bot. Web administration, when available, is only for adults approved by their team. You do not need a web account to scout.",
  "We keep your Telegram identifier, team membership, a display name used by the team, and the messages you submit. We also keep extracted scouting results, follow-up conversations, delivery records and correction requests so we can process notes reliably. Please describe robots and matches, and avoid names or other personal details about people in your notes. We do not ask for birthdays, identity documents, school details or demographic information.",
  "When you request web access, we store the name, contact email, FRC team number, team role and adult attestation you provide, along with the submission time and review status. Application owners and authorized service operators use these details to review your request. The details are kept for up to 90 days after submission. Submitting does not create an account or grant team access. We do not send a confirmation email in this release.",
  "Your notes go to our extraction service and its AI model provider. Our hosting and database providers store the information needed to operate the service. Authorized people on your team and service operators can access information needed for their work; team investigation tools can show a scout's display name. We do not share scouting data between teams. Future team API exports exclude scout identifiers and internal account records, but requested notes can still contain personal details. They are not anonymous.",
  "Approved adult web administrators may use Clerk for login and Unkey for team API keys. Telegram scouts are not automatically registered with these services. These providers receive the authentication or key-verification information needed to provide their services. Providers may process information outside Canada. We use essential security and operational telemetry, with no product analytics or session replay in this release.",
  "Our retention policy limits scouting messages and results to the end of the season plus 90 days. Account links are removed within 30 days after membership ends; routine security logs are kept for up to 30 days. Backups may take another 30 days to expire. Specific incident or legal holds may require longer retention. The operator must verify these cleanup settings before release.",
  "Contact your team's responsible adult lead to ask to see, correct or delete your information, or to report an accidental underage web registration. A parent or guardian may help you make a request. Your lead will involve the service operator when needed. We aim to acknowledge requests within seven days and complete them within 30 days, explaining any delay. We cannot directly erase copies held by Telegram or people who already downloaded information.",
  "Organizations must provide their lead's working contact alongside this notice before enrollment. The detailed handling rules and release checks are in Privacy boundaries.\n",
];

export default function PrivacyPage() {
  return (
    <main id="main" className="mx-auto max-w-3xl space-y-6 px-6 py-12">
      <h1 className="text-2xl font-semibold">Your scouting information</h1>
      {paragraphs.map((paragraph) => (
        <p key={paragraph}>{paragraph}</p>
      ))}
    </main>
  );
}

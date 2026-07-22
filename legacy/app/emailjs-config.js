// EmailJS configuration for daily email digest.
//
// 1. Sign up free at https://www.emailjs.com
// 2. Add an Email Service (Gmail, Outlook, etc.) → copy the Service ID.
// 3. Create an Email Template with variables: {{subject}}, {{body}}
//    → copy the Template ID.
// 4. Go to Account → API Keys → copy the Public Key.
// 5. Fill in the values below and set emailjsEnabled to true.
//
// Free tier: 200 emails/month — more than enough for daily summaries.

export const emailjsEnabled = true;

export const emailjsConfig = {
  publicKey: "DjkU4Hk_SAK_2yCfm",
  serviceId: "service_0y6dd3d",
  templateId: "template_7d3ne7g",
  recipientEmail: "oceancoders15@email.com"
};

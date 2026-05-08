/**
 * Consent Document
 *
 * Informed consent text for the StreamSync BPH study.
 * Structured for display in the consent screen.
 *
 * Note: This is a template - actual consent text should be
 * reviewed and approved by your IRB.
 */

import { STUDY_INFO, CONSENT_VERSION } from '../constants';

/**
 * Section of the consent document
 */
export interface ConsentSection {
  id: string;
  title: string;
  content: string;
  required?: boolean; // Must scroll through to proceed
}

/**
 * Full consent document structure
 */
export interface ConsentDocument {
  version: string;
  title: string;
  studyName: string;
  institution: string;
  principalInvestigator: string;
  irbProtocol: string;
  sections: ConsentSection[];
  signatureRequired: boolean;
}

/**
 * StreamSync study consent document
 */
export const CONSENT_DOCUMENT: ConsentDocument = {
  version: CONSENT_VERSION,
  title: 'Informed Consent',
  studyName: STUDY_INFO.name,
  institution: STUDY_INFO.institution,
  principalInvestigator: STUDY_INFO.principalInvestigator,
  irbProtocol: STUDY_INFO.irbProtocol,
  signatureRequired: true,

  sections: [
    {
      id: 'overview',
      title: 'Study Overview',
      required: true,
      content: `You are invited to participate in a research study on benign prostatic hyperplasia (BPH) and lower urinary tract symptoms. This study is being conducted across multiple academic medical centers to evaluate whether relief of bladder outlet obstruction can improve objective quality of life and activity measures using wearable devices and home uroflow measurement.

**Protocol Title:** ${STUDY_INFO.name}

**Protocol Director (PI):** ${STUDY_INFO.principalInvestigator}

**IRB Number:** ${STUDY_INFO.irbProtocol}`,
    },
    {
      id: 'purpose',
      title: 'Purpose of the Study',
      required: true,
      content: `The purpose of this research is to determine whether improvement in bladder outlet obstruction is associated with measurable improvements in daily activity, sleep, and urinary flow patterns. The results may help improve diagnosis and guide treatment of lower urinary tract symptoms.`,
    },
    {
      id: 'procedures',
      title: 'Study Procedures',
      required: true,
      content: `If you choose to participate, you will be asked to take part in the following:

\u2022 Registration and setup, including study screening, consent, initial surveys, and mobile application setup (approximately 30 minutes).

\u2022 Use of a wearable device (such as a smartwatch) that you already own. You will be asked to wear the device daily and allow data collected by the device to be shared with the study team through the StreamSync research application.

\u2022 Installation and use of a smart toilet\u2013based uroflow measurement device (Throne One) attached to your home toilet. You will be asked to record as many voids as possible during a one-week period.

\u2022 Completion of survey questionnaires collecting demographic information, medical history, and urinary symptoms, including follow-up surveys at 1, 2, and 3 months after surgery.

\u2022 Sharing of medical information from your medical record and from other health systems through Apple Health and related integrations, with your permission.`,
    },
    {
      id: 'risks',
      title: 'Risks and Discomforts',
      required: true,
      content: `The risks associated with this study include the time required to download, set up, and use the mobile applications and devices. There is a very small risk of inadvertent disclosure of private health information related to your voiding or wearable data. Although safeguards are in place, there is a small risk of data security breaches.`,
    },
    {
      id: 'benefits',
      title: 'Benefits',
      required: true,
      content: `You may not receive any direct benefit from participating in this study. The potential benefit is contributing to research that may improve understanding of voiding dysfunction and help develop better diagnostic and treatment tools for future patients.`,
    },
    {
      id: 'privacy',
      title: 'Privacy and Data Protection',
      required: true,
      content: `Your data will be handled securely and used only for research purposes. Identifiable information may be removed, and de-identified data may be used for future research studies or shared with other investigators without additional consent. All reasonable efforts will be made to protect your privacy.

Although safeguards are in place, there is a small risk of data security breaches.`,
    },
    {
      id: 'hipaa',
      title: 'HIPAA Authorization',
      required: true,
      content: `By participating in this study, you authorize the sharing of medical information from your medical record and from other health systems through Apple Health and related integrations, with your permission.

Your data will be handled securely and used only for research purposes. Identifiable information may be removed, and de-identified data may be used for future research studies or shared with other investigators without additional consent. All reasonable efforts will be made to protect your privacy.

Although safeguards are in place, there is a small risk of data security breaches.

You may choose not to participate or to withdraw from the study at any time without penalty or loss of benefits to which you are otherwise entitled. Your decision will not affect your medical care.`,
    },
    {
      id: 'compensation',
      title: 'Compensation',
      required: false,
      content: `You will receive $100 for successful completion of the study.`,
    },
    {
      id: 'voluntary',
      title: 'Voluntary Participation',
      required: true,
      content: `Your participation in this study is voluntary. You may choose not to participate or to withdraw from the study at any time without penalty or loss of benefits to which you are otherwise entitled. Your decision will not affect your medical care.`,
    },
    {
      id: 'contact',
      title: 'Contact Information',
      required: true,
      content: `If you have questions, concerns, or complaints about this research study, you may contact the Protocol Director:

${STUDY_INFO.principalInvestigator}
Phone: ${STUDY_INFO.contactPhone}

You may also contact the study's Institutional Review Board (IRB) of record for independent information about your rights as a research participant. Contact details for the IRB of record are provided by your enrolling site's research coordinator.`,
    },
  ],
};

/**
 * Get consent sections that require reading
 */
export function getRequiredSections(): ConsentSection[] {
  return CONSENT_DOCUMENT.sections.filter((s) => s.required);
}

/**
 * Get all consent sections
 */
export function getAllSections(): ConsentSection[] {
  return CONSENT_DOCUMENT.sections;
}

/**
 * Short profile-friendly summary of what the user consented to.
 * Derived from the 'purpose' and 'privacy' sections above.
 */
export const CONSENT_PROFILE_SUMMARY =
  `This study evaluates whether relief of bladder outlet obstruction improves daily activity, sleep, and urinary flow patterns using wearable devices and home uroflow measurement. ` +
  `Your data is handled securely, used only for research purposes, and de-identified where possible. ` +
  `You may withdraw at any time without affecting your medical care.`;

/**
 * Short profile-friendly summary of what data the app can access.
 * Derived from the 'procedures' and 'hipaa' sections above.
 */
export const DATA_PERMISSIONS_SUMMARY = [
  'Daily activity and sleep data from your Apple Watch or wearable device',
  'Urinary flow measurements from the Throne uroflow device',
  'Survey responses about symptoms and medical history',
  'Medical information shared through Apple Health with your permission',
];

/**
 * Study coordinator contact info for the Profile screen.
 */
export const STUDY_COORDINATOR = {
  name: 'StreamSync Study Team',
  role: 'Study Coordinator',
  email: STUDY_INFO.contactEmail,
  phone: STUDY_INFO.contactPhone,
} as const;

/**
 * Generate a summary of consent for confirmation
 */
export function getConsentSummary(): string {
  return `By signing below, I confirm that:

- I have read and understood the consent document
- I have had the opportunity to ask questions
- I understand the risks and benefits of participation
- I understand I can withdraw at any time
- I agree to participate in the ${STUDY_INFO.name}

Version: ${CONSENT_VERSION}`;
}

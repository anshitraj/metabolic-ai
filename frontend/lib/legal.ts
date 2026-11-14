// Who stands behind Metabolic AI, for the legal pages. Set these on the web app
// (server env) before launch — Google's OAuth consent screen checks that these
// pages name a real business and a way to reach it. Anything unset is left out
// rather than invented.

export const LEGAL = {
  /** Registered business name, e.g. "Metabolic Labs Private Limited". */
  entity: process.env.LEGAL_ENTITY_NAME || "Metabolic AI",
  /** Registered office address, one line. */
  address: process.env.LEGAL_ADDRESS || "",
  /** Where users write for help and privacy requests. */
  supportEmail: process.env.SUPPORT_EMAIL || "",
  /** Grievance Officer under India's IT Rules and DPDP Act. */
  grievanceName: process.env.GRIEVANCE_OFFICER_NAME || "",
  grievanceEmail: process.env.GRIEVANCE_OFFICER_EMAIL || process.env.SUPPORT_EMAIL || "",
  /** City whose courts hear disputes, e.g. "Bengaluru". */
  jurisdiction: process.env.LEGAL_JURISDICTION || "",
  /** How the documents name the business: `Acme Pvt Ltd ("Metabolic AI", "we")`, or just `Metabolic AI ("we")` until an entity is set. */
  get who() {
    return this.entity === "Metabolic AI" ? `Metabolic AI ("we")` : `${this.entity} ("Metabolic AI", "we")`;
  },
  /** Shown on every legal page. Update when the text changes. */
  updated: "14 November 2026",
};

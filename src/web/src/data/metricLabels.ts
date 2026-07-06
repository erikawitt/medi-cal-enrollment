import type {
  CitizenshipMetric,
  EthnicityMetric,
} from "@medi-cal-disenrollment/shared";

/** Display order + labels for the ethnicity marginal breakdown. */
export const ETHNICITY_LABELS: readonly [EthnicityMetric, string][] = [
  ["eth_hispanic_latino", "Hispanic / Latino"],
  ["eth_white", "White"],
  ["eth_black_african_american", "Black / African Am."],
  ["eth_asian", "Asian"],
  ["eth_aian", "AIAN"],
  ["eth_nhpi", "NHPI"],
  ["eth_two_or_more", "Two or more"],
  ["eth_other", "Other"],
];

/** Display order + labels for the citizenship marginal breakdown. */
export const CITIZENSHIP_LABELS: readonly [CitizenshipMetric, string][] = [
  ["cit_citizen", "Citizen"],
  ["cit_documented", "Documented"],
  ["cit_undocumented", "Undocumented"],
  ["cit_other", "Other"],
];

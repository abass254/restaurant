export const LEGAL_ENTITY_NAME = "Nextverse Solutions Limited";
export const LEGAL_ENTITY_LOCATION = "Nairobi, Kenya";
export const PRODUCT_NAME = "TransChap";

export function legalFooterLine(year: number): string {
  return `© ${year} ${LEGAL_ENTITY_NAME}. ${PRODUCT_NAME} · ${LEGAL_ENTITY_LOCATION}.`;
}

export const LEGAL_OPERATOR_LINE = `${PRODUCT_NAME} is operated by ${LEGAL_ENTITY_NAME}, ${LEGAL_ENTITY_LOCATION}.`;

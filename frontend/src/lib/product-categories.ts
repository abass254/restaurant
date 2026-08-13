/**
 * Predefined product/service categories.
 *
 * Each category has a list of structured fields the form should show after
 * the user picks the category. The values are stored on the catalog product
 * as a JSON `attributes` blob. Adding a new category is a single object
 * push — no backend changes required.
 *
 * Conventions for field keys: lowercase snake_case. Use stable keys; changing
 * one breaks already-saved data.
 */

import type { ProductType } from "./types";

export type ProductCategoryField = {
  key: string;
  label: string;
  type: "text" | "textarea" | "number" | "select" | "multiselect";
  placeholder?: string;
  help?: string;
  unit?: string;
  options?: { value: string; label: string }[];
  /** Only show this field when another field has one of these values. */
  showWhen?: { key: string; equals: string | string[] };
};

export type ProductCategoryDef = {
  id: string;
  label: string;
  icon: string; // Font Awesome icon class (without `fa-`)
  appliesTo: ProductType[];
  /** Shown beneath the category picker as a hint. */
  blurb?: string;
  fields: ProductCategoryField[];
};

const GENDER_OPTIONS = [
  { value: "unisex", label: "Unisex / Anyone" },
  { value: "men", label: "Men" },
  { value: "women", label: "Women" },
  { value: "kids", label: "Kids" },
];

const YES_NO = [
  { value: "yes", label: "Yes" },
  { value: "no", label: "No" },
];

const STORAGE_OPTIONS = [
  { value: "ambient", label: "Room temperature" },
  { value: "refrigerated", label: "Refrigerated" },
  { value: "frozen", label: "Frozen" },
];

export const PRODUCT_CATEGORIES: ProductCategoryDef[] = [
  // ============================================================ PRODUCTS
  {
    id: "food_beverage",
    label: "Food & Beverage",
    icon: "fa-utensils",
    appliesTo: ["product"],
    blurb: "Drinks, snacks, restaurant items, fresh produce.",
    fields: [
      { key: "size", label: "Size / Volume", type: "text", placeholder: "e.g. 500ml, 2kg" },
      {
        key: "dietary",
        label: "Dietary tags",
        type: "multiselect",
        options: [
          { value: "halal", label: "Halal" },
          { value: "vegan", label: "Vegan" },
          { value: "vegetarian", label: "Vegetarian" },
          { value: "gluten_free", label: "Gluten-free" },
          { value: "sugar_free", label: "Sugar-free" },
          { value: "organic", label: "Organic" },
        ],
      },
      { key: "storage", label: "Storage", type: "select", options: STORAGE_OPTIONS },
      { key: "ingredients", label: "Ingredients", type: "textarea", placeholder: "Comma-separated" },
      { key: "shelf_life_days", label: "Shelf life", type: "number", unit: "days" },
    ],
  },
  {
    id: "groceries",
    label: "Groceries & Pantry",
    icon: "fa-basket-shopping",
    appliesTo: ["product"],
    blurb: "Staples — flour, sugar, oil, cereals, household pantry.",
    fields: [
      { key: "weight", label: "Weight / Volume", type: "text", placeholder: "e.g. 2kg, 1L" },
      { key: "origin", label: "Country of origin", type: "text", placeholder: "e.g. Kenya" },
      { key: "organic", label: "Organic?", type: "select", options: YES_NO },
      { key: "storage", label: "Storage", type: "select", options: STORAGE_OPTIONS },
    ],
  },
  {
    id: "beauty_cosmetics",
    label: "Beauty & Cosmetics",
    icon: "fa-spray-can-sparkles",
    appliesTo: ["product"],
    blurb: "Skincare, makeup, fragrances, personal care.",
    fields: [
      { key: "volume", label: "Size / Volume", type: "text", placeholder: "e.g. 50ml" },
      {
        key: "skin_type",
        label: "Skin type",
        type: "select",
        options: [
          { value: "all", label: "All skin types" },
          { value: "oily", label: "Oily" },
          { value: "dry", label: "Dry" },
          { value: "combination", label: "Combination" },
          { value: "sensitive", label: "Sensitive" },
        ],
      },
      { key: "scent", label: "Scent / Fragrance", type: "text", placeholder: "e.g. Vanilla" },
      { key: "ingredients", label: "Key ingredients", type: "textarea" },
      { key: "use_within_months", label: "Use within", type: "number", unit: "months" },
    ],
  },
  {
    id: "clothing",
    label: "Clothing & Apparel",
    icon: "fa-shirt",
    appliesTo: ["product"],
    blurb: "T-shirts, dresses, suits, kitenge, traditional wear.",
    fields: [
      {
        key: "size",
        label: "Size",
        type: "select",
        options: [
          { value: "XS", label: "XS" },
          { value: "S", label: "S" },
          { value: "M", label: "M" },
          { value: "L", label: "L" },
          { value: "XL", label: "XL" },
          { value: "XXL", label: "XXL" },
          { value: "custom", label: "Custom / Numeric" },
        ],
      },
      {
        key: "size_custom",
        label: "Custom size",
        type: "text",
        placeholder: "e.g. 32, 34, free size",
        showWhen: { key: "size", equals: "custom" },
      },
      { key: "color", label: "Color", type: "text", placeholder: "e.g. Navy blue" },
      { key: "material", label: "Material / Fabric", type: "text", placeholder: "e.g. 100% cotton" },
      { key: "gender", label: "For", type: "select", options: GENDER_OPTIONS },
      {
        key: "season",
        label: "Season",
        type: "select",
        options: [
          { value: "all", label: "All seasons" },
          { value: "hot", label: "Hot / Sunny" },
          { value: "cold", label: "Cold" },
          { value: "rainy", label: "Rainy" },
        ],
      },
    ],
  },
  {
    id: "footwear",
    label: "Footwear",
    icon: "fa-shoe-prints",
    appliesTo: ["product"],
    fields: [
      { key: "size", label: "Size (EU)", type: "text", placeholder: "e.g. 42" },
      { key: "color", label: "Color", type: "text" },
      { key: "material", label: "Material", type: "text", placeholder: "e.g. Leather" },
      { key: "gender", label: "For", type: "select", options: GENDER_OPTIONS },
    ],
  },
  {
    id: "electronics",
    label: "Electronics & Gadgets",
    icon: "fa-mobile-screen-button",
    appliesTo: ["product"],
    blurb: "Phones, laptops, accessories, audio, smart home.",
    fields: [
      { key: "model_number", label: "Model number", type: "text" },
      { key: "color", label: "Color", type: "text" },
      { key: "warranty_months", label: "Warranty", type: "number", unit: "months" },
      { key: "voltage", label: "Voltage / Power", type: "text", placeholder: "e.g. 110-240V" },
      { key: "in_the_box", label: "What's in the box", type: "textarea", placeholder: "Comma-separated" },
    ],
  },
  {
    id: "home_furniture",
    label: "Home & Furniture",
    icon: "fa-couch",
    appliesTo: ["product"],
    fields: [
      { key: "dimensions", label: "Dimensions (L×W×H)", type: "text", placeholder: "e.g. 200×90×75 cm" },
      { key: "weight", label: "Weight", type: "text", placeholder: "e.g. 15 kg" },
      { key: "material", label: "Material", type: "text", placeholder: "e.g. Mahogany" },
      { key: "color", label: "Color / Finish", type: "text" },
      { key: "assembly_required", label: "Assembly required?", type: "select", options: YES_NO },
      {
        key: "room",
        label: "Room",
        type: "select",
        options: [
          { value: "living", label: "Living room" },
          { value: "bedroom", label: "Bedroom" },
          { value: "kitchen", label: "Kitchen" },
          { value: "office", label: "Office" },
          { value: "outdoor", label: "Outdoor" },
        ],
      },
    ],
  },
  {
    id: "books_media",
    label: "Books, Stationery & Media",
    icon: "fa-book",
    appliesTo: ["product"],
    fields: [
      { key: "author", label: "Author / Creator", type: "text" },
      { key: "isbn", label: "ISBN", type: "text" },
      { key: "publisher", label: "Publisher", type: "text" },
      { key: "language", label: "Language", type: "text" },
      {
        key: "format",
        label: "Format",
        type: "select",
        options: [
          { value: "paperback", label: "Paperback" },
          { value: "hardcover", label: "Hardcover" },
          { value: "ebook", label: "E-book" },
          { value: "audio", label: "Audio" },
        ],
      },
      { key: "pages", label: "Pages", type: "number" },
    ],
  },
  {
    id: "health_pharmacy",
    label: "Health & Pharmacy",
    icon: "fa-pills",
    appliesTo: ["product"],
    blurb: "OTC medicines, supplements, first aid.",
    fields: [
      { key: "active_ingredient", label: "Active ingredient(s)", type: "text" },
      { key: "dosage", label: "Dosage / Strength", type: "text", placeholder: "e.g. 500mg" },
      {
        key: "form",
        label: "Form",
        type: "select",
        options: [
          { value: "tablet", label: "Tablet" },
          { value: "capsule", label: "Capsule" },
          { value: "syrup", label: "Syrup" },
          { value: "cream", label: "Cream / Ointment" },
          { value: "drops", label: "Drops" },
          { value: "injection", label: "Injection" },
          { value: "other", label: "Other" },
        ],
      },
      {
        key: "prescription",
        label: "Requires prescription?",
        type: "select",
        options: [
          { value: "yes", label: "Yes (Rx only)" },
          { value: "no", label: "No (OTC)" },
        ],
      },
      { key: "age_restriction", label: "Age restriction", type: "text", placeholder: "e.g. 12+" },
    ],
  },
  {
    id: "baby_kids",
    label: "Baby & Kids",
    icon: "fa-baby",
    appliesTo: ["product"],
    fields: [
      { key: "age_range", label: "Age range", type: "text", placeholder: "e.g. 0-6 months, 3-5 years" },
      {
        key: "gender",
        label: "For",
        type: "select",
        options: [
          { value: "unisex", label: "Unisex" },
          { value: "boys", label: "Boys" },
          { value: "girls", label: "Girls" },
        ],
      },
      { key: "safety_certified", label: "Safety certified?", type: "select", options: YES_NO },
    ],
  },
  {
    id: "automotive",
    label: "Automotive & Parts",
    icon: "fa-car",
    appliesTo: ["product"],
    fields: [
      { key: "make", label: "Vehicle make", type: "text", placeholder: "e.g. Toyota" },
      { key: "model", label: "Vehicle model", type: "text", placeholder: "e.g. Corolla" },
      { key: "year_range", label: "Year range", type: "text", placeholder: "e.g. 2010-2015" },
      { key: "part_number", label: "Part number / OEM", type: "text" },
    ],
  },
  {
    id: "hardware_tools",
    label: "Hardware & Tools",
    icon: "fa-screwdriver-wrench",
    appliesTo: ["product"],
    fields: [
      { key: "size", label: "Size / Dimension", type: "text" },
      { key: "material", label: "Material", type: "text" },
      {
        key: "power",
        label: "Power",
        type: "select",
        options: [
          { value: "manual", label: "Manual" },
          { value: "electric", label: "Electric (mains)" },
          { value: "battery", label: "Battery / Cordless" },
          { value: "pneumatic", label: "Pneumatic" },
        ],
      },
    ],
  },

  // ============================================================ SERVICES
  {
    id: "salon_beauty",
    label: "Salon & Beauty",
    icon: "fa-hand-sparkles",
    appliesTo: ["service"],
    blurb: "Hair, nails, makeup, lashes, skincare treatments.",
    fields: [
      { key: "duration_minutes", label: "Duration", type: "number", unit: "minutes" },
      {
        key: "area",
        label: "Service area",
        type: "select",
        options: [
          { value: "hair", label: "Hair" },
          { value: "face", label: "Face" },
          { value: "nails", label: "Nails" },
          { value: "body", label: "Body" },
          { value: "full", label: "Full service" },
        ],
      },
      { key: "gender", label: "For", type: "select", options: GENDER_OPTIONS },
      { key: "home_service", label: "Home service available?", type: "select", options: YES_NO },
    ],
  },
  {
    id: "cleaning",
    label: "Cleaning",
    icon: "fa-broom",
    appliesTo: ["service"],
    fields: [
      {
        key: "scope",
        label: "Cleaning scope",
        type: "select",
        options: [
          { value: "general", label: "General" },
          { value: "deep", label: "Deep clean" },
          { value: "move_out", label: "Move-out" },
          { value: "post_construction", label: "Post-construction" },
          { value: "carpet", label: "Carpet / Upholstery" },
        ],
      },
      { key: "coverage", label: "Coverage", type: "text", placeholder: "e.g. 80 sqm or 3 BR" },
      { key: "duration_hours", label: "Duration", type: "number", unit: "hours" },
      { key: "supplies_included", label: "Supplies provided?", type: "select", options: YES_NO },
    ],
  },
  {
    id: "repair_general",
    label: "Repair & Maintenance",
    icon: "fa-wrench",
    appliesTo: ["service"],
    blurb: "Phones, laptops, appliances, anything that breaks.",
    fields: [
      { key: "fixes", label: "What you fix", type: "text", placeholder: "e.g. phones, laptops" },
      { key: "duration_minutes", label: "Typical duration", type: "number", unit: "minutes" },
      { key: "warranty_days", label: "Repair warranty", type: "number", unit: "days" },
      { key: "diagnostic_included", label: "Diagnostic included?", type: "select", options: YES_NO },
    ],
  },
  {
    id: "auto_repair",
    label: "Auto Repair / Car Service",
    icon: "fa-car-burst",
    appliesTo: ["service"],
    fields: [
      {
        key: "service_type",
        label: "Service type",
        type: "select",
        options: [
          { value: "oil_change", label: "Oil change" },
          { value: "tires", label: "Tires / Alignment" },
          { value: "engine", label: "Engine work" },
          { value: "body", label: "Body work / Painting" },
          { value: "diagnostic", label: "Diagnostic" },
          { value: "full_service", label: "Full service" },
        ],
      },
      { key: "vehicle_type", label: "Vehicle type", type: "text", placeholder: "e.g. Saloon, SUV, lorry" },
      { key: "duration_hours", label: "Duration", type: "number", unit: "hours" },
      { key: "parts_included", label: "Parts included?", type: "select", options: YES_NO },
    ],
  },
  {
    id: "education",
    label: "Tutoring & Education",
    icon: "fa-graduation-cap",
    appliesTo: ["service"],
    fields: [
      { key: "subject", label: "Subject", type: "text", placeholder: "e.g. Math, English, Coding" },
      {
        key: "level",
        label: "Level",
        type: "select",
        options: [
          { value: "primary", label: "Primary / KCPE" },
          { value: "secondary", label: "Secondary / KCSE" },
          { value: "college", label: "College / University" },
          { value: "adult", label: "Adult learner" },
        ],
      },
      { key: "session_minutes", label: "Session length", type: "number", unit: "minutes" },
      {
        key: "group_size",
        label: "Group size",
        type: "select",
        options: [
          { value: "1on1", label: "1-on-1" },
          { value: "small", label: "Small group (2-5)" },
          { value: "class", label: "Class (6+)" },
        ],
      },
      {
        key: "delivery",
        label: "Delivery",
        type: "select",
        options: [
          { value: "in_person", label: "In person" },
          { value: "online", label: "Online" },
          { value: "both", label: "Both" },
        ],
      },
    ],
  },
  {
    id: "transport",
    label: "Transport & Delivery",
    icon: "fa-truck",
    appliesTo: ["service"],
    fields: [
      {
        key: "vehicle",
        label: "Vehicle type",
        type: "select",
        options: [
          { value: "boda", label: "Boda boda" },
          { value: "tuktuk", label: "Tuk-tuk" },
          { value: "saloon", label: "Saloon car" },
          { value: "pickup", label: "Pickup" },
          { value: "lorry", label: "Lorry / Truck" },
        ],
      },
      { key: "capacity", label: "Capacity", type: "text", placeholder: "e.g. 500kg or 4 passengers" },
      { key: "coverage", label: "Coverage area", type: "text", placeholder: "e.g. Nairobi metro" },
      { key: "same_day", label: "Same-day delivery?", type: "select", options: YES_NO },
    ],
  },
  {
    id: "photography",
    label: "Photography & Video",
    icon: "fa-camera",
    appliesTo: ["service"],
    fields: [
      {
        key: "event_type",
        label: "Event type",
        type: "select",
        options: [
          { value: "wedding", label: "Wedding" },
          { value: "portrait", label: "Portrait" },
          { value: "product", label: "Product" },
          { value: "event", label: "Event / Corporate" },
          { value: "video", label: "Video / Film" },
        ],
      },
      { key: "duration_hours", label: "Duration", type: "number", unit: "hours" },
      { key: "delivery_days", label: "Delivery time", type: "number", unit: "days" },
      { key: "includes", label: "What's included", type: "textarea", placeholder: "Edited photos, USB, prints…" },
    ],
  },
  {
    id: "event_services",
    label: "Event Services",
    icon: "fa-calendar-day",
    appliesTo: ["service"],
    blurb: "Catering, decor, MC, sound, planning.",
    fields: [
      { key: "event_type", label: "Event type", type: "text", placeholder: "e.g. Wedding, conference" },
      { key: "capacity", label: "Capacity", type: "number", unit: "guests" },
      { key: "duration_hours", label: "Duration", type: "number", unit: "hours" },
      { key: "includes", label: "Inclusions", type: "textarea", placeholder: "Catering, decor, MC…" },
    ],
  },
  {
    id: "tailoring",
    label: "Tailoring & Alterations",
    icon: "fa-scissors",
    appliesTo: ["service"],
    fields: [
      { key: "garment_type", label: "Garment type", type: "text", placeholder: "e.g. Suit, kitenge, dress" },
      {
        key: "service_type",
        label: "Service",
        type: "select",
        options: [
          { value: "custom", label: "Custom-made" },
          { value: "alteration", label: "Alteration / Resizing" },
          { value: "repair", label: "Repair" },
          { value: "embroidery", label: "Embroidery / Print" },
        ],
      },
      { key: "turnaround_days", label: "Turnaround", type: "number", unit: "days" },
    ],
  },

  // ============================================================ CATCH-ALL
  {
    id: "other",
    label: "Other",
    icon: "fa-tag",
    appliesTo: ["product", "service"],
    fields: [],
  },
];

export function getCategory(id: string | null | undefined): ProductCategoryDef | null {
  if (!id) return null;
  return PRODUCT_CATEGORIES.find((c) => c.id === id) ?? null;
}

export function categoriesFor(productType: ProductType): ProductCategoryDef[] {
  return PRODUCT_CATEGORIES.filter((c) => c.appliesTo.includes(productType));
}

export function optionLabel(field: ProductCategoryField, value: string): string {
  if (!field.options) return value;
  return field.options.find((o) => o.value === value)?.label ?? value;
}

/**
 * Decide whether a conditional field should be visible right now.
 */
export function isFieldVisible(
  field: ProductCategoryField,
  attributes: Record<string, unknown>,
): boolean {
  if (!field.showWhen) return true;
  const current = attributes[field.showWhen.key];
  if (Array.isArray(field.showWhen.equals)) {
    return field.showWhen.equals.includes(current as string);
  }
  return current === field.showWhen.equals;
}

/**
 * Build a human-readable description from the structured catalog fields.
 * Used to autofill the description textarea — the user can edit afterwards.
 */
export function buildAutoDescription(input: {
  name: string;
  brand?: string | null;
  product_type: ProductType;
  category?: string | null;
  unit?: string | null;
  attributes?: Record<string, unknown> | null;
}): string {
  const cat = getCategory(input.category);
  const lines: string[] = [];

  // Opening line: "<Brand> <Name> is a <category> <product|service>."
  const lead: string[] = [];
  if (input.brand) lead.push(input.brand);
  if (input.name) lead.push(input.name);

  const noun = input.product_type === "service" ? "service" : "product";
  if (lead.length && cat) {
    lines.push(`${lead.join(" ")} — a ${cat.label.toLowerCase()} ${noun}.`);
  } else if (lead.length) {
    lines.push(`${lead.join(" ")}.`);
  }

  // Per-attribute bullets.
  const attrs = input.attributes ?? {};
  if (cat) {
    for (const field of cat.fields) {
      if (!isFieldVisible(field, attrs)) continue;
      const raw = attrs[field.key];
      if (raw == null || raw === "" || (Array.isArray(raw) && raw.length === 0)) {
        continue;
      }
      let valueStr: string;
      if (Array.isArray(raw)) {
        valueStr = raw.map((v) => optionLabel(field, String(v))).join(", ");
      } else if (field.type === "select") {
        valueStr = optionLabel(field, String(raw));
      } else {
        valueStr = String(raw);
      }
      if (field.unit && /^\d/.test(valueStr)) {
        valueStr = `${valueStr} ${field.unit}`;
      }
      lines.push(`• ${field.label}: ${valueStr}`);
    }
  }

  return lines.join("\n").trim();
}

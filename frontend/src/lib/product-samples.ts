/**
 * Hand-curated sample products & services for the "Fill with sample" button.
 *
 * Used to populate the Add-product form with believable data so the team can
 * eyeball the dynamic fields and the description-autofill behaviour without
 * typing for ten minutes.
 *
 * Each sample's `category` must match a `ProductCategoryDef.id` and its
 * `attributes` keys must match that category's `fields[].key`s — otherwise
 * the form will silently ignore them.
 */

import type { ProductType } from "./types";

export type ProductSample = {
  product_type: ProductType;
  category: string;
  name: string;
  brand?: string;
  unit?: string;
  sku?: string;
  attributes: Record<string, unknown>;
};

export const PRODUCT_SAMPLES: ProductSample[] = [
  // ============================================== Food & Beverage
  {
    product_type: "product",
    category: "food_beverage",
    name: "Tusker Lager 500ml",
    brand: "Tusker",
    unit: "bottle",
    sku: "6161101800040",
    attributes: {
      size: "500ml",
      dietary: ["halal"],
      storage: "ambient",
      shelf_life_days: 365,
    },
  },
  {
    product_type: "product",
    category: "food_beverage",
    name: "Coca-Cola 1L PET",
    brand: "Coca-Cola",
    unit: "bottle",
    sku: "5449000054227",
    attributes: {
      size: "1L",
      dietary: ["halal", "vegetarian"],
      storage: "ambient",
      ingredients: "Carbonated water, sugar, caramel colour, phosphoric acid, caffeine, natural flavours.",
      shelf_life_days: 270,
    },
  },
  {
    product_type: "product",
    category: "food_beverage",
    name: "Brookside Fresh Milk 500ml",
    brand: "Brookside",
    unit: "pouch",
    attributes: {
      size: "500ml",
      dietary: ["vegetarian", "halal"],
      storage: "refrigerated",
      shelf_life_days: 5,
    },
  },
  {
    product_type: "product",
    category: "food_beverage",
    name: "Cadbury Dairy Milk Chocolate 90g",
    brand: "Cadbury",
    unit: "bar",
    attributes: {
      size: "90g",
      dietary: ["vegetarian"],
      storage: "ambient",
      shelf_life_days: 365,
    },
  },

  // ============================================== Groceries
  {
    product_type: "product",
    category: "groceries",
    name: "Pembe Wheat Flour 2kg",
    brand: "Pembe",
    unit: "pack",
    attributes: {
      weight: "2kg",
      origin: "Kenya",
      organic: "no",
      storage: "ambient",
    },
  },
  {
    product_type: "product",
    category: "groceries",
    name: "Ketepa Pride Loose Tea 500g",
    brand: "Ketepa",
    unit: "pack",
    attributes: {
      weight: "500g",
      origin: "Kenya",
      organic: "no",
      storage: "ambient",
    },
  },
  {
    product_type: "product",
    category: "groceries",
    name: "Soko Maize Flour 2kg",
    brand: "Soko",
    unit: "pack",
    attributes: {
      weight: "2kg",
      origin: "Kenya",
      organic: "no",
      storage: "ambient",
    },
  },

  // ============================================== Beauty & Cosmetics
  {
    product_type: "product",
    category: "beauty_cosmetics",
    name: "Nivea Cocoa Body Lotion 250ml",
    brand: "Nivea",
    unit: "bottle",
    attributes: {
      volume: "250ml",
      skin_type: "dry",
      scent: "Cocoa butter",
      use_within_months: 24,
    },
  },
  {
    product_type: "product",
    category: "beauty_cosmetics",
    name: "Maybelline Fit Me Foundation",
    brand: "Maybelline",
    unit: "bottle",
    attributes: {
      volume: "30ml",
      skin_type: "all",
      use_within_months: 12,
    },
  },

  // ============================================== Clothing
  {
    product_type: "product",
    category: "clothing",
    name: "Kitenge Wrap Dress",
    brand: "Vivo Activewear",
    unit: "piece",
    attributes: {
      size: "M",
      color: "Yellow & blue print",
      material: "100% cotton kitenge",
      gender: "women",
      season: "all",
    },
  },
  {
    product_type: "product",
    category: "clothing",
    name: "Plain Crew-Neck T-Shirt — White",
    unit: "piece",
    attributes: {
      size: "L",
      color: "White",
      material: "Cotton/poly blend",
      gender: "unisex",
      season: "all",
    },
  },

  // ============================================== Footwear
  {
    product_type: "product",
    category: "footwear",
    name: "Bata Safari Boot",
    brand: "Bata",
    unit: "pair",
    attributes: {
      size: "42",
      color: "Brown",
      material: "Leather",
      gender: "men",
    },
  },

  // ============================================== Electronics
  {
    product_type: "product",
    category: "electronics",
    name: "Tecno Spark 10 64GB",
    brand: "Tecno",
    unit: "piece",
    attributes: {
      model_number: "KI5q",
      color: "Meta Black",
      warranty_months: 12,
      voltage: "110-240V",
      in_the_box: "Phone, charger, USB-C cable, SIM ejector, manual",
    },
  },
  {
    product_type: "product",
    category: "electronics",
    name: "Wireless Bluetooth Earbuds",
    brand: "Oraimo",
    unit: "piece",
    attributes: {
      model_number: "FreePods 4",
      color: "Black",
      warranty_months: 6,
      in_the_box: "Earbuds, charging case, USB-C cable, ear tips, manual",
    },
  },

  // ============================================== Home & Furniture
  {
    product_type: "product",
    category: "home_furniture",
    name: "Mahogany Coffee Table",
    unit: "piece",
    attributes: {
      dimensions: "120×60×45 cm",
      weight: "18 kg",
      material: "Mahogany hardwood",
      color: "Dark walnut",
      assembly_required: "yes",
      room: "living",
    },
  },

  // ============================================== Books, Stationery & Media
  {
    product_type: "product",
    category: "books_media",
    name: "The River Between",
    brand: "East African Educational Publishers",
    unit: "copy",
    attributes: {
      author: "Ngugi wa Thiong'o",
      isbn: "9789966253095",
      publisher: "East African Educational Publishers",
      language: "English",
      format: "paperback",
      pages: 152,
    },
  },

  // ============================================== Health & Pharmacy
  {
    product_type: "product",
    category: "health_pharmacy",
    name: "Paracetamol 500mg Tablets (Strip of 10)",
    brand: "GSK",
    unit: "strip",
    attributes: {
      active_ingredient: "Paracetamol",
      dosage: "500mg",
      form: "tablet",
      prescription: "no",
      age_restriction: "6+",
    },
  },

  // ============================================== Baby & Kids
  {
    product_type: "product",
    category: "baby_kids",
    name: "Pampers Active Baby Pants — Medium (44 pack)",
    brand: "Pampers",
    unit: "pack",
    attributes: {
      age_range: "6-11 kg",
      gender: "unisex",
      safety_certified: "yes",
    },
  },

  // ============================================== Automotive
  {
    product_type: "product",
    category: "automotive",
    name: "Front Brake Pads — Toyota Corolla",
    brand: "Bosch",
    unit: "set",
    attributes: {
      make: "Toyota",
      model: "Corolla",
      year_range: "2010-2015",
      part_number: "BP-1234-COR",
    },
  },

  // ============================================== Hardware & Tools
  {
    product_type: "product",
    category: "hardware_tools",
    name: "Stanley Claw Hammer 16oz",
    brand: "Stanley",
    unit: "piece",
    attributes: {
      size: "16oz / 450g",
      material: "Forged steel head, fibreglass handle",
      power: "manual",
    },
  },

  // ============================================== Salon & Beauty (service)
  {
    product_type: "service",
    category: "salon_beauty",
    name: "Full Hair Braiding (Knotless)",
    attributes: {
      duration_minutes: 240,
      area: "hair",
      gender: "women",
      home_service: "yes",
    },
  },
  {
    product_type: "service",
    category: "salon_beauty",
    name: "Gel Manicure",
    attributes: {
      duration_minutes: 60,
      area: "nails",
      gender: "women",
      home_service: "no",
    },
  },
  {
    product_type: "service",
    category: "salon_beauty",
    name: "Men's Haircut & Beard Trim",
    attributes: {
      duration_minutes: 45,
      area: "hair",
      gender: "men",
      home_service: "no",
    },
  },

  // ============================================== Cleaning (service)
  {
    product_type: "service",
    category: "cleaning",
    name: "Standard Apartment Clean (3 BR)",
    attributes: {
      scope: "general",
      coverage: "3 BR / ~100 sqm",
      duration_hours: 4,
      supplies_included: "yes",
    },
  },

  // ============================================== Repair & Maintenance (service)
  {
    product_type: "service",
    category: "repair_general",
    name: "Phone Screen Replacement",
    attributes: {
      fixes: "Smartphones — most makes & models",
      duration_minutes: 90,
      warranty_days: 30,
      diagnostic_included: "yes",
    },
  },

  // ============================================== Auto Repair (service)
  {
    product_type: "service",
    category: "auto_repair",
    name: "Oil Change & Filter (Saloon)",
    attributes: {
      service_type: "oil_change",
      vehicle_type: "Saloon car",
      duration_hours: 1,
      parts_included: "yes",
    },
  },

  // ============================================== Tutoring (service)
  {
    product_type: "service",
    category: "education",
    name: "KCSE Mathematics Tuition",
    attributes: {
      subject: "Mathematics",
      level: "secondary",
      session_minutes: 90,
      group_size: "1on1",
      delivery: "both",
    },
  },

  // ============================================== Transport & Delivery (service)
  {
    product_type: "service",
    category: "transport",
    name: "Boda Boda CBD Delivery",
    attributes: {
      vehicle: "boda",
      capacity: "Up to 20 kg / 1 passenger",
      coverage: "Nairobi CBD & surrounds",
      same_day: "yes",
    },
  },

  // ============================================== Photography (service)
  {
    product_type: "service",
    category: "photography",
    name: "Wedding Photography — Full Day",
    attributes: {
      event_type: "wedding",
      duration_hours: 10,
      delivery_days: 21,
      includes: "Edited photos (300+), online gallery, USB drive, 20 prints",
    },
  },

  // ============================================== Event Services (service)
  {
    product_type: "service",
    category: "event_services",
    name: "Event MC & Sound System",
    attributes: {
      event_type: "Wedding / Corporate",
      capacity: 200,
      duration_hours: 6,
      includes: "MC, PA system, 2 wireless mics, mood lighting",
    },
  },

  // ============================================== Tailoring (service)
  {
    product_type: "service",
    category: "tailoring",
    name: "Custom-Made Suit (2-Piece)",
    attributes: {
      garment_type: "Men's suit",
      service_type: "custom",
      turnaround_days: 14,
    },
  },
];

/**
 * Return a sample at random. If `currentName` is provided we'll do our best
 * to return something different so consecutive clicks don't feel stuck.
 */
export function pickRandomSample(currentName?: string | null): ProductSample {
  if (PRODUCT_SAMPLES.length <= 1) return PRODUCT_SAMPLES[0];
  for (let attempt = 0; attempt < 5; attempt++) {
    const idx = Math.floor(Math.random() * PRODUCT_SAMPLES.length);
    const candidate = PRODUCT_SAMPLES[idx];
    if (!currentName || candidate.name !== currentName) return candidate;
  }
  return PRODUCT_SAMPLES[0];
}

import type { Language } from "./types";
import type { AtlasEditorSection } from "./atlas-taxonomy";

export type AtlasMetadataFieldType = "text" | "tel" | "email" | "url" | "number" | "textarea" | "select";

export type AtlasMetadataFieldDefinition = {
  key: string;
  section: AtlasEditorSection;
  type: AtlasMetadataFieldType;
  label: Record<Language, string>;
  placeholder?: Partial<Record<Language, string>>;
  options?: readonly { value: string; label: Record<Language, string> }[];
  maxLength?: number;
};

const option = (value: string, ku: string, ar: string, en: string) => ({ value, label: { ku, ar, en } });

export const ATLAS_METADATA_FIELDS: readonly AtlasMetadataFieldDefinition[] = [
  { key: "governorate", section: "administrative", type: "text", label: { ku: "پارێزگا", ar: "المحافظة", en: "Governorate" }, maxLength: 120 },
  { key: "district", section: "administrative", type: "text", label: { ku: "قەزا", ar: "القضاء", en: "District" }, maxLength: 120 },
  { key: "subdistrict", section: "administrative", type: "text", label: { ku: "ناحیە", ar: "الناحية", en: "Subdistrict" }, maxLength: 120 },
  { key: "municipality", section: "administrative", type: "text", label: { ku: "شارەوانی", ar: "البلدية", en: "Municipality" }, maxLength: 120 },
  { key: "neighbourhood", section: "administrative", type: "text", label: { ku: "گەڕەک / ناوچە", ar: "الحي / المنطقة", en: "Neighbourhood / area" }, maxLength: 160 },

  { key: "phone", section: "contact", type: "tel", label: { ku: "ژمارەی پەیوەندی", ar: "رقم الهاتف", en: "Phone" }, maxLength: 64 },
  { key: "phone_alt", section: "contact", type: "tel", label: { ku: "ژمارەی دووەم", ar: "هاتف بديل", en: "Alternate phone" }, maxLength: 64 },
  { key: "email", section: "contact", type: "email", label: { ku: "ئیمەیڵ", ar: "البريد الإلكتروني", en: "Email" }, maxLength: 180 },
  { key: "website", section: "contact", type: "url", label: { ku: "وێبسایت", ar: "الموقع الإلكتروني", en: "Website" }, maxLength: 400 },
  { key: "facebook", section: "contact", type: "url", label: { ku: "فەیسبووک", ar: "فيسبوك", en: "Facebook" }, maxLength: 400 },
  { key: "instagram", section: "contact", type: "url", label: { ku: "ئینستاگرام", ar: "إنستغرام", en: "Instagram" }, maxLength: 400 },

  { key: "opening_hours", section: "operations", type: "text", label: { ku: "کاتی کار", ar: "ساعات العمل", en: "Opening hours" }, placeholder: { ku: "نموونە: 08:00–16:00", ar: "مثال: 08:00–16:00", en: "Example: 08:00–16:00" }, maxLength: 180 },
  { key: "operator", section: "operations", type: "text", label: { ku: "بەڕێوەبەر / خاوەن", ar: "المشغّل / المالك", en: "Operator / owner" }, maxLength: 180 },
  { key: "brand", section: "operations", type: "text", label: { ku: "براند", ar: "العلامة التجارية", en: "Brand" }, maxLength: 180 },
  { key: "ref", section: "operations", type: "text", label: { ku: "کۆد / ژمارەی ناساندن", ar: "الرمز / المرجع", en: "Reference code" }, maxLength: 120 },
  { key: "access", section: "operations", type: "select", label: { ku: "دەستگەیشتن", ar: "إمكانية الوصول", en: "Access" }, options: [option("public", "گشتی", "عام", "Public"), option("customers", "تەنها کڕیار", "للعملاء", "Customers only"), option("private", "تایبەت", "خاص", "Private"), option("restricted", "سنووردار", "مقيّد", "Restricted")] },
  { key: "fee", section: "operations", type: "select", label: { ku: "پارە وەرگیراوە؟", ar: "يتطلب رسوماً؟", en: "Fee required?" }, options: [option("no", "نەخێر", "لا", "No"), option("yes", "بەڵێ", "نعم", "Yes"), option("unknown", "نادیار", "غير معروف", "Unknown")] },

  { key: "emergency_phone", section: "emergency", type: "tel", label: { ku: "ژمارەی فریاکەوتن", ar: "هاتف الطوارئ", en: "Emergency phone" }, maxLength: 64 },
  { key: "response_area", section: "emergency", type: "text", label: { ku: "ناوچەی خزمەتگوزاری", ar: "منطقة الاستجابة", en: "Response area" }, maxLength: 180 },
  { key: "dispatch_available", section: "emergency", type: "select", label: { ku: "وەڵامدانەوەی 24 کاتژمێر", ar: "استجابة 24 ساعة", en: "24-hour response" }, options: [option("yes", "بەڵێ", "نعم", "Yes"), option("no", "نەخێر", "لا", "No")] },

  { key: "speciality", section: "health", type: "text", label: { ku: "پسپۆڕی", ar: "التخصص", en: "Speciality" }, maxLength: 180 },
  { key: "beds", section: "health", type: "number", label: { ku: "ژمارەی جێگای نەخۆش", ar: "عدد الأسرّة", en: "Beds" } },
  { key: "emergency_service", section: "health", type: "select", label: { ku: "فریاکەوتنی پزیشکی", ar: "خدمة طوارئ", en: "Emergency service" }, options: [option("yes", "بەڵێ", "نعم", "Yes"), option("no", "نەخێر", "لا", "No")] },
  { key: "ambulance", section: "health", type: "select", label: { ku: "ئەمبولانس", ar: "إسعاف", en: "Ambulance" }, options: [option("yes", "هەیە", "متوفر", "Available"), option("no", "نییە", "غير متوفر", "Not available")] },

  { key: "education_level", section: "education", type: "text", label: { ku: "ئاستی خوێندن", ar: "المستوى التعليمي", en: "Education level" }, maxLength: 180 },
  { key: "student_capacity", section: "education", type: "number", label: { ku: "توانای قوتابی", ar: "سعة الطلبة", en: "Student capacity" } },
  { key: "gender", section: "education", type: "select", label: { ku: "ڕەگەز", ar: "الجنس", en: "Gender" }, options: [option("mixed", "تێکەڵ", "مختلط", "Mixed"), option("male", "نێر", "ذكور", "Male"), option("female", "مێ", "إناث", "Female")] },
  { key: "operator_type", section: "education", type: "select", label: { ku: "جۆری بەڕێوەبردن", ar: "نوع الإدارة", en: "Operator type" }, options: [option("public", "حکومی", "حكومي", "Public"), option("private", "تایبەت", "خاص", "Private"), option("ngo", "ڕێکخراو", "منظمة", "NGO")] },

  { key: "route_ref", section: "transport", type: "text", label: { ku: "ژمارەی ڕێڕەو", ar: "رقم المسار", en: "Route reference" }, maxLength: 120 },
  { key: "service_area", section: "transport", type: "text", label: { ku: "مەودای خزمەتگوزاری", ar: "نطاق الخدمة", en: "Service area" }, maxLength: 180 },
  { key: "parking_capacity", section: "transport", type: "number", label: { ku: "توانای پارکینگ", ar: "سعة المواقف", en: "Parking capacity" } },
  { key: "fuel_types", section: "transport", type: "text", label: { ku: "جۆرەکانی سووتەمەنی", ar: "أنواع الوقود", en: "Fuel types" }, maxLength: 180 },

  { key: "cuisine", section: "hospitality", type: "text", label: { ku: "جۆری خواردن", ar: "نوع المطبخ", en: "Cuisine" }, maxLength: 180 },
  { key: "delivery", section: "hospitality", type: "select", label: { ku: "گەیاندن", ar: "التوصيل", en: "Delivery" }, options: [option("yes", "هەیە", "متوفر", "Available"), option("no", "نییە", "غير متوفر", "Not available")] },
  { key: "takeaway", section: "hospitality", type: "select", label: { ku: "خواردنی بۆ دەرەوە", ar: "طلبات خارجية", en: "Takeaway" }, options: [option("yes", "هەیە", "متوفر", "Available"), option("no", "نییە", "غير متوفر", "Not available")] },
  { key: "stars", section: "hospitality", type: "number", label: { ku: "ئەستێرە", ar: "النجوم", en: "Stars" } },
  { key: "rooms", section: "hospitality", type: "number", label: { ku: "ژمارەی ژوور", ar: "عدد الغرف", en: "Rooms" } },

  { key: "product_focus", section: "commerce", type: "text", label: { ku: "بەرهەمی سەرەکی", ar: "المنتج الرئيسي", en: "Main product" }, maxLength: 180 },
  { key: "wholesale", section: "commerce", type: "select", label: { ku: "کۆمەڵفرۆشی", ar: "بيع بالجملة", en: "Wholesale" }, options: [option("yes", "بەڵێ", "نعم", "Yes"), option("no", "نەخێر", "لا", "No")] },

  { key: "licence_ref", section: "business", type: "text", label: { ku: "ژمارەی مۆڵەت", ar: "رقم الترخيص", en: "Licence reference" }, maxLength: 120 },
  { key: "service_speciality", section: "business", type: "text", label: { ku: "پسپۆڕی خزمەتگوزاری", ar: "اختصاص الخدمة", en: "Service speciality" }, maxLength: 180 },

  { key: "religion", section: "culture", type: "text", label: { ku: "ئاین", ar: "الديانة", en: "Religion" }, maxLength: 120 },
  { key: "denomination", section: "culture", type: "text", label: { ku: "مەزهەب / ڕێباز", ar: "الطائفة / المذهب", en: "Denomination" }, maxLength: 160 },
  { key: "memorial_type", section: "culture", type: "text", label: { ku: "جۆری یادەوەری", ar: "نوع النصب", en: "Memorial type" }, maxLength: 160 },

  { key: "tourism_type", section: "tourism", type: "text", label: { ku: "جۆری گەشتیاری", ar: "نوع السياحة", en: "Tourism type" }, maxLength: 180 },
  { key: "season", section: "tourism", type: "text", label: { ku: "وەرزی گونجاو", ar: "الموسم المناسب", en: "Best season" }, maxLength: 180 },
  { key: "guide_available", section: "tourism", type: "select", label: { ku: "ڕێبەری گەشت هەیە؟", ar: "دليل سياحي متوفر؟", en: "Tour guide available?" }, options: [option("yes", "بەڵێ", "نعم", "Yes"), option("no", "نەخێر", "لا", "No")] },

  { key: "sport", section: "leisure", type: "text", label: { ku: "جۆری وەرزش", ar: "نوع الرياضة", en: "Sport" }, maxLength: 180 },
  { key: "capacity", section: "leisure", type: "number", label: { ku: "توانا", ar: "السعة", en: "Capacity" } },
  { key: "surface", section: "leisure", type: "text", label: { ku: "جۆری زەوی", ar: "نوع السطح", en: "Surface" }, maxLength: 120 },

  { key: "network", section: "infrastructure", type: "text", label: { ku: "تۆڕ", ar: "الشبكة", en: "Network" }, maxLength: 180 },
  { key: "voltage", section: "infrastructure", type: "text", label: { ku: "ڤۆڵتاژ", ar: "الجهد", en: "Voltage" }, maxLength: 120 },
  { key: "output_capacity", section: "infrastructure", type: "text", label: { ku: "توانای بەرهەم", ar: "الطاقة الإنتاجية", en: "Output capacity" }, maxLength: 180 },

  { key: "industry", section: "industry", type: "text", label: { ku: "جۆری پیشەسازی", ar: "نوع الصناعة", en: "Industry" }, maxLength: 180 },
  { key: "product", section: "industry", type: "text", label: { ku: "بەرهەم", ar: "المنتج", en: "Product" }, maxLength: 180 },
  { key: "production_capacity", section: "industry", type: "text", label: { ku: "توانای بەرهەمهێنان", ar: "الطاقة الإنتاجية", en: "Production capacity" }, maxLength: 180 },

  { key: "building_levels", section: "residential", type: "number", label: { ku: "ژمارەی نهۆم", ar: "عدد الطوابق", en: "Building levels" } },
  { key: "units", section: "residential", type: "number", label: { ku: "ژمارەی یەکە", ar: "عدد الوحدات", en: "Units" } },
  { key: "occupancy", section: "residential", type: "text", label: { ku: "بەکارهێنان", ar: "الإشغال", en: "Occupancy" }, maxLength: 180 },

  { key: "service_type", section: "technology", type: "text", label: { ku: "جۆری خزمەتگوزاری", ar: "نوع الخدمة", en: "Service type" }, maxLength: 180 },
  { key: "coverage", section: "technology", type: "text", label: { ku: "مەودای داپۆشین", ar: "نطاق التغطية", en: "Coverage" }, maxLength: 180 },

  { key: "crossing_type", section: "border", type: "text", label: { ku: "جۆری دەروازە", ar: "نوع المعبر", en: "Crossing type" }, maxLength: 180 },
  { key: "customs", section: "border", type: "select", label: { ku: "گومرگ هەیە؟", ar: "توجد جمارك؟", en: "Customs available?" }, options: [option("yes", "بەڵێ", "نعم", "Yes"), option("no", "نەخێر", "لا", "No")] }
] as const;

const FIELD_BY_KEY = new Map<string, AtlasMetadataFieldDefinition>(ATLAS_METADATA_FIELDS.map((field) => [field.key, field]));

export function atlasMetadataFieldsForSections(sections: readonly AtlasEditorSection[]): AtlasMetadataFieldDefinition[] {
  const allowed = new Set(sections);
  return ATLAS_METADATA_FIELDS.filter((field) => allowed.has(field.section));
}


export function atlasMetadataFieldLabel(key: string, language: Language): string {
  return FIELD_BY_KEY.get(key)?.label[language] ?? key.replace(/_/g, " ");
}

const SECTION_LABELS: Record<AtlasEditorSection, Record<Language, string>> = {
  administrative: { ku: "کارگێڕی و ناونیشان", ar: "الإدارة والعنوان", en: "Administration & address" },
  contact: { ku: "پەیوەندی", ar: "التواصل", en: "Contact" },
  operations: { ku: "کارکردن و دەستگەیشتن", ar: "التشغيل والوصول", en: "Operations & access" },
  emergency: { ku: "فریاکەوتن", ar: "الطوارئ", en: "Emergency" },
  health: { ku: "زانیاری تەندروستی", ar: "بيانات صحية", en: "Healthcare details" },
  education: { ku: "زانیاری پەروەردە", ar: "بيانات تعليمية", en: "Education details" },
  transport: { ku: "هاتووچۆ و گواستنەوە", ar: "النقل والحركة", en: "Transport details" },
  hospitality: { ku: "خواردن و میوانداری", ar: "الطعام والضيافة", en: "Hospitality details" },
  commerce: { ku: "بازرگانی", ar: "التجارة", en: "Commerce details" },
  business: { ku: "خزمەتگوزاری پیشەیی", ar: "الخدمات المهنية", en: "Business details" },
  culture: { ku: "کولتوور و ئاین", ar: "الثقافة والدين", en: "Culture & religion" },
  tourism: { ku: "گەشتیاری", ar: "السياحة", en: "Tourism details" },
  leisure: { ku: "وەرزش و کات بەسەربردن", ar: "الرياضة والترفيه", en: "Sports & leisure" },
  infrastructure: { ku: "ژێرخان", ar: "البنية التحتية", en: "Infrastructure" },
  industry: { ku: "پیشەسازی و کشتوکاڵ", ar: "الصناعة والزراعة", en: "Industry & agriculture" },
  residential: { ku: "نیشتەجێبوون و بیناسازی", ar: "السكن والمباني", en: "Residential details" },
  technology: { ku: "پەیوەندی و تەکنەلۆژیا", ar: "الاتصالات والتقنية", en: "Technology details" },
  border: { ku: "سنوور و دەروازە", ar: "الحدود والمعابر", en: "Border details" }
};

export function atlasEditorSectionLabel(section: AtlasEditorSection, language: Language): string {
  return SECTION_LABELS[section][language];
}

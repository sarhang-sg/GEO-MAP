type ErrorLanguage = "ku" | "ar" | "en";

/** Internal classification only. Never render this text into the interface. */
export function errorDescription(error: unknown): string {
  if (typeof error === "string") return error;
  if (!error || typeof error !== "object") return "";
  const value = error as Record<string, unknown>;
  return [value.name, value.message, value.error_description, value.details, value.code, value.status]
    .filter((part) => typeof part === "string" || typeof part === "number").join(" ");
}

const COPY = {
  ku: {
    general: "هەڵەیەک ڕوویدا. تکایە دووبارە هەوڵ بدەوە.",
    network: "پەیوەندی بەردەست نییە. ئینتەرنێتەکەت بپشکنە و دووبارە هەوڵ بدەوە.",
    session: "تکایە دووبارە بچۆ ژوورەوە و هەوڵ بدەوە.",
    input: "زانیارییە نووسراوەکان بپشکنە و دووبارە هەوڵ بدەوە.",
    image: "وێنەکە پەسەند نەکرا. وێنەی JPEG، PNG یان WebP بە قەبارەی تا ١٠ MB هەڵبژێرە.",
    wait: "تکایە کەمێک چاوەڕێ بکە، پاشان دووبارە هەوڵ بدەوە."
  },
  ar: {
    general: "حدث خطأ. يرجى المحاولة مرة أخرى.",
    network: "الاتصال غير متاح. تحقق من الإنترنت وحاول مرة أخرى.",
    session: "يرجى تسجيل الدخول مجددًا ثم المحاولة.",
    input: "تحقق من المعلومات المدخلة ثم حاول مرة أخرى.",
    image: "تعذر قبول الصورة. اختر صورة JPEG أو PNG أو WebP بحجم لا يتجاوز 10 MB.",
    wait: "يرجى الانتظار قليلًا ثم المحاولة مرة أخرى."
  },
  en: {
    general: "Something went wrong. Please try again.",
    network: "Connection unavailable. Check your internet and try again.",
    session: "Please sign in again and retry.",
    input: "Check the information you entered and try again.",
    image: "This image could not be accepted. Choose a JPEG, PNG or WebP image up to 10 MB.",
    wait: "Please wait a moment and try again."
  }
} as const;

export function userFacingError(error: unknown, language?: ErrorLanguage): string {
  const selected = language ?? (typeof document === "undefined" ? "en" : document.body?.dataset.language ?? document.documentElement?.lang);
  const copy = COPY[selected === "ckb" ? "ku" : selected === "ku" || selected === "ar" ? selected : "en"];
  const detail = errorDescription(error);
  if (/auth session missing|session.*expired|sign.in.*required|invalid.*jwt|jwt.*expired|not authenticated|\b401\b/i.test(detail)) return copy.session;
  if (/rate.limit|too many requests|\b429\b/i.test(detail)) return copy.wait;
  if (/failed to fetch|failed to send a request|networkerror|network request failed|load failed|offline|timed? ?out|connection (?:failed|lost|refused|reset|unavailable)/i.test(detail)) return copy.network;
  if (/image.*(empty|smaller|too large)|10 MB|JPEG, PNG|unsupported.*image|mime.type/i.test(detail)) return copy.image;
  if (/outside the allowed.*(script|writing)|contains invalid script|must be.*(characters|words|number)|name is required|inside the Kurdistan project boundary|unsupported control characters/i.test(detail)) return copy.input;
  // No raw message, stack, response, SQL, function name or provider hint is ever
  // used as a fallback, including errors supplied by an OAuth redirect.
  return copy.general;
}

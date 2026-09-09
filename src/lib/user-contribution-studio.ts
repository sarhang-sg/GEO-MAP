import { appUrl } from "./app-url";
import {
  acceptAtlasLegalTerms,
  atlasErrorMessage,
  atlasPlaceWithRevisionPreview,
  deleteAtlasAccountAndData,
  clearAtlasNavigationHistory,
  deleteAtlasNavigationHistory,
  deleteAtlasNotification,
  deleteManagedAtlasPhoto,
  deleteOwnAtlasFeedback,
  deleteReadAtlasNotifications,
  deleteUserAtlasPlace,
  consumeAtlasOAuthCallbackError,
  getAtlasAuthIdentity,
  getAtlasUserProfile,
  isAtlasBackendConfigured,
  loadAtlasNotifications,
  loadUserAtlasFeedback,
  loadUserAtlasPlaces,
  markAllAtlasNotificationsRead,
  markAtlasNotificationRead,
  orderedAtlasPhotos,
  saveUserAtlasSubmission,
  updateOwnAtlasFeedback,
  signInAtlasWithGoogle,
  signOutAtlasUser,
  subscribeToAtlasAuth,
  subscribeToAtlasPlaces,
  uploadUserAtlasPhoto,
  withdrawUserAtlasApprovedPlace,
  withdrawUserAtlasRevision,
  withdrawUserAtlasSubmission,
  type AtlasAuthIdentity,
  type AtlasCategory,
  type AtlasFeedback,
  type AtlasFeedbackCategory,
  type AtlasNotification,
  type AtlasNavigationHistory,
  type AtlasPlace,
  type AtlasUserProfile
} from "./atlas-places";
import {
  ATLAS_TAXONOMY,
  ATLAS_TAXONOMY_GROUPS,
  atlasPlaceTypeGroup,
  atlasPlaceTypeSearchTerms,
  atlasTaxonomyEntry
} from "./atlas-taxonomy";
import {
  ATLAS_MEDIA_POLICY,
  ATLAS_TEXT_LIMITS,
  atlasLimitAttributes,
  atlasTextMatchesScript,
  countAtlasWords,
  normalizeAtlasTags,
  type AtlasScriptPolicy,
  type AtlasTextLimit
} from "./atlas-content-policy";
import { atlasMarkerAssetUrl } from "./atlas-marker-catalog";
import { normalizeAtlasImageFile, prepareAtlasImage } from "./atlas-image-processor";
import { escapeText, languageDirection, type StudioCoordinate, type StudioLanguage } from "./owner-studio-copy";
import { ownerName } from "./geo-format";
import { restoreClampedScroll } from "./mobile-dialog-layout";
import { dialogCloseIcon } from "./dialog-close-icon";
import { loadSynchronizedNavigationHistory, removePendingNavigationHistory } from "./navigation-history-store";

type UserStudioView = "signin" | "dashboard" | "editor" | "admin-blocked" | "unavailable";
type UserDashboardTab = "places" | "messages" | "notifications" | "account";
type ChoiceKind = "group" | "type" | null;
const PENDING_NEW_PLACE_STORAGE_KEY = "nav-kurd-pending-new-place-v1";
const PENDING_NEW_PLACE_MAX_AGE_MS = 15 * 60 * 1000;
type UserPendingConfirmation =
  | { kind: "signout" }
  | { kind: "delete-account" }
  | { kind: "delete-place"; placeId: string }
  | { kind: "delete-photo"; placeId: string; photoId: string }
  | { kind: "delete-feedback"; feedbackId: string }
  | { kind: "delete-notification"; notificationId: string }
  | { kind: "delete-history"; historyId: string }
  | { kind: "clear-history" }
  | null;

type UserStudioOptions = {
  getLanguage: () => StudioLanguage;
  requestMapPoint: (onPick: (coordinate: StudioCoordinate) => void) => void;
  onPlacesChanged: () => Promise<void> | void;
  onUnreadCountChange?: (count: number) => void;
  onAdminIdentity?: () => Promise<void> | void;
};

function localizedLegalUrl(path: string, language: StudioLanguage): string {
  const target = appUrl(path);
  return `${target}${target.includes("?") ? "&" : "?"}lang=${language}`;
}

type Copy = {
  title: string;
  subtitle: string;
  close: string;
  signInTitle: string;
  signInBody: string;
  signInGoogle: string;
  legalPrefix: string;
  privacy: string;
  terms: string;
  guidelines: string;
  dashboard: string;
  addPlace: string;
  noPlaces: string;
  notifications: string;
  noNotifications: string;
  pending: string;
  approved: string;
  rejected: string;
  withdrawn: string;
  edit: string;
  withdraw: string;
  save: string;
  back: string;
  nameKu: string;
  nameAr: string;
  nameEn: string;
  group: string;
  type: string;
  descriptionKu: string;
  descriptionAr: string;
  descriptionEn: string;
  location: string;
  pickMap: string;
  longitude: string;
  latitude: string;
  photo: string;
  captionKu: string;
  captionAr: string;
  captionEn: string;
  chooseFile: string;
  noFileChosen: string;
  photoHelp: string;
  photoSelected: string;
  photoChange: string;
  photoRemove: string;
  photoDelete: string;
  photoDeleteConfirm: string;
  photoDeleted: string;
  photoCleanupWarning: string;
  invalidPhoto: string;
  photoTooLarge: string;
  characters: string;
  words: string;
  arabicScriptHint: string;
  latinScriptHint: string;
  fieldRequired: string;
  wrongArabicScript: string;
  wrongLatinScript: string;
  characterLimitExceeded: string;
  wordLimitExceeded: string;
  coordinateInvalid: string;
  coordinateRange: string;
  uploadPreparing: string;
  uploadingPhoto: string;
  uploadComplete: string;
  submitHint: string;
  legalAccept: string;
  legalAcceptAction: string;
  legalRequired: string;
  saved: string;
  withdrawnMessage: string;
  signOut: string;
  signOutConfirmTitle: string;
  signOutConfirmBody: string;
  signOutConfirmAction: string;
  account: string;
  deleteRequest: string;
  deletionRequested: string;
  deleteConfirm: string;
  adminBlocked: string;
  revisionPending: string;
  revisionRejected: string;
  revisionWithdrawn: string;
  search: string;
  required: string;
  optional: string;
  markAllRead: string;
  deleteReadNotifications: string;
  deletePlace: string;
  deletePlaceConfirm: string;
  deleteAccountTitle: string;
  confirmCancel: string;
  confirmDelete: string;
  deletePlaceSuccess: string;
  deletePlaceCleanupWarning: string;
  notificationsMarkedRead: string;
  readNotificationsDeleted: string;
  savingPlace: string;
  photoCompressing: string;
  photoCompressed: string;
  photoUploadFailedSaved: string;
  unavailable: string;
};

const COPY: Record<StudioLanguage, Copy> = {
  ku: {
    title: "هەژمار و بەشداری",
    subtitle: "بە گووگڵ بچۆ ژوورەوە، شوێن پێشنیار بکە و دۆخی ڕیڤیو ببینە.",
    close: "داخستن",
    signInTitle: "چوونەژوورەوە بە Google",
    signInBody: "هەر کەسێک دەتوانێت شوێنێک پێشنیار بکات؛ هیچ شوێنێک پێش پەسەندکردنی ئەدمین بڵاوناکرێتەوە.",
    signInGoogle: "چوونەژوورەوە بە Google",
    legalPrefix: "بە چوونەژوورەوە، ڕەزامەندی دەدەیت بە",
    privacy: "سیاسەتی تایبەتمەندی",
    terms: "مەرجەکانی بەکارهێنان",
    guidelines: "ڕێنمایی بەشداری",
    dashboard: "داشبۆردی من",
    addPlace: "پێشنیارکردنی شوێن",
    noPlaces: "هێشتا هیچ شوێنێکت پێشنیار نەکردووە.",
    notifications: "ئاگادارکردنەوەکان",
    noNotifications: "هیچ ئاگادارکردنەوەیەکی نوێ نییە.",
    pending: "لە چاوەڕوانی ڕیڤیو",
    approved: "پەسەندکراو",
    rejected: "پێویستی بە دەستکاری هەیە",
    withdrawn: "هەڵوەشێنراوەتەوە",
    edit: "دەستکاری",
    withdraw: "هەڵوەشاندنەوە",
    save: "ناردن بۆ ڕیڤیو",
    back: "گەڕانەوە",
    nameKu: "ناوی کوردی",
    nameAr: "ناوی عەرەبی",
    nameEn: "English name",
    group: "بەشی سەرەکی",
    type: "جۆری وردی شوێن",
    descriptionKu: "وەسفی کوردی",
    descriptionAr: "وەسفی عەرەبی",
    descriptionEn: "English description",
    location: "شوێن و کۆئۆردینات",
    pickMap: "دیاریکردن لەسەر ماپ",
    longitude: "درێژی",
    latitude: "پانی",
    photo: "وێنەی ئارەزومەندانە",
    captionKu: "کەپشنی کوردی",
    captionAr: "کەپشنی عەرەبی",
    captionEn: "English caption",
    chooseFile: "هەڵبژاردنی وێنە",
    noFileChosen: "هێشتا هیچ وێنەیەک هەڵنەبژێردراوە",
    photoHelp: "تەنها JPEG، PNG یان WebP · زۆرترین 10 MB بۆ هەر وێنە · زۆرترین 12 وێنە بۆ هەر شوێن",
    photoSelected: "وێنەی هەڵبژێردراو",
    photoChange: "گۆڕینی وێنە",
    photoRemove: "لابردنی وێنە",
    photoDelete: "سڕینەوەی وێنە",
    photoDeleteConfirm: "دڵنیایت دەتەوێت ئەم وێنەیە بە هەمیشەیی بسڕیتەوە؟ گەڕاندنەوەی نییە.",
    photoDeleted: "وێنەکە بە سەرکەوتوویی سڕایەوە.",
    photoCleanupWarning: "وێنەکە لە لیستەکە سڕایەوە، بەڵام پاککردنەوەی فایلی هەڵگیراو پێویستی بە دووبارە هەوڵدان هەیە.",
    invalidPhoto: "تەنها وێنەی JPEG، PNG یان WebP ڕێگەپێدراوە.",
    photoTooLarge: "قەبارەی وێنەکە نابێت لە 10 MB زیاتر بێت.",
    characters: "پیت",
    words: "وشە",
    arabicScriptHint: "تەنها پیتی کوردی/عەرەبی؛ ژمارە و نیشانە ڕێگەپێدراون.",
    latinScriptHint: "تەنها پیتی لاتینی/ئینگلیزی؛ ژمارە و نیشانە ڕێگەپێدراون.",
    fieldRequired: "ئەم خانەیە پێویستە.",
    wrongArabicScript: "ئەم خانەیە تەنها پیتی کوردی/عەرەبی وەردەگرێت.",
    wrongLatinScript: "ئەم خانەیە تەنها پیتی لاتینی/ئینگلیزی وەردەگرێت.",
    characterLimitExceeded: "سنوری ژمارەی پیت تێپەڕێندراوە.",
    wordLimitExceeded: "سنوری ژمارەی وشە تێپەڕێندراوە.",
    coordinateInvalid: "کۆئۆردیناتەکە دروست نییە.",
    coordinateRange: "شوێنەکە دەبێت لە ناو سنوری ماپی NAV KURD بێت.",
    uploadPreparing: "ئامادەکردنی داواکاری...",
    uploadingPhoto: "بارکردنی وێنە...",
    uploadComplete: "تەواو بوو",
    submitHint: "شوێنەکە سەرەتا وەک Pending دەنێردرێت و تەنها دوای پەسەندکردنی ئەدمین بڵاودەبێتەوە.",
    legalAccept: "سیاسەتی تایبەتمەندی، مەرجەکان و ڕێنمایی بەشداری خوێندمەوە و پەسەندیان دەکەم.",
    legalAcceptAction: "پەسەندکردن و بەردەوامبوون",
    legalRequired: "پێش ناردنی شوێن، دەبێت مەرجەکان و سیاسەتی تایبەتمەندی پەسەند بکەیت.",
    saved: "داواکارییەکەت بۆ ڕیڤیو نێردرا.",
    withdrawnMessage: "داواکارییەکەت هەڵوەشێندرایەوە.",
    signOut: "چوونەدەرەوە",
    signOutConfirmTitle: "دڵنیایت دەتەوێت بچیتە دەرەوە؟",
    signOutConfirmBody: "هەژمارەکەت ناسراو دەمێنێتەوە، بەڵام session ـەکەت لەم ئامێرەدا دادەخرێت. دەتوانیت هەر کاتێک دووبارە بە Google بچیتە ژوورەوە.",
    signOutConfirmAction: "بەڵێ، بچۆ دەرەوە",
    account: "هەژمار",
    deleteRequest: "سڕینەوەی هەژمار و داتا",
    deletionRequested: "هەژمار و داتای تایبەتی تۆ بە سەرکەوتوویی سڕایەوە.",
    deleteConfirm: "دڵنیایت؟ ئەم کردارە هەژمار، شوێنەکان، وێنەکان و داتای تایبەتی تۆ بە شێوەی هەمیشەیی دەسڕێتەوە و گەڕاندنەوەی نییە.",
    adminBlocked: "هەژماری بەڕێوەبەر لە هەژماری یوزەری ئاسایی جیاکراوەتەوە. بۆ بەڕێوەبردن، بەشی تایبەتی ئەدمین بەکاربهێنە.",
    revisionPending: "دەستکارییەکە لە چاوەڕوانی ڕیڤیوە؛ وەشانی پەسەندکراوی پێشوو هەر بۆ خەڵک دیارە.",
    revisionRejected: "دەستکارییەکە ڕەتکرایەوە و دەتوانیت چاکی بکەیت و دووبارە بۆ ڕیڤیو بینێریت.",
    revisionWithdrawn: "دەستکارییەکە هەڵوەشێندرایەوە و دەتوانیت دووبارە دەستکاری بکەیت.",
    search: "گەڕان",
    required: "پێویست",
    optional: "ئارەزومەندانە",
    markAllRead: "هەمووی وەک خوێندراو",
    deleteReadNotifications: "سڕینەوەی ئاگادارکردنەوە خوێندراوەکان",
    deletePlace: "سڕینەوەی شوێن",
    deletePlaceConfirm: "دڵنیایت دەتەوێت ئەم شوێنە بە هەمیشەیی بسڕیتەوە؟ هەموو وێنە و داتای پەیوەندیداری خۆت دەسڕدرێتەوە و گەڕاندنەوەی نییە.",
    deleteAccountTitle: "سڕینەوەی هەژمار و داتا",
    confirmCancel: "پاشگەزبوونەوە",
    confirmDelete: "سڕینەوەی هەمیشەیی",
    deletePlaceSuccess: "شوێنەکە و داتای پەیوەندیداری بە سەرکەوتوویی سڕایەوە.",
    deletePlaceCleanupWarning: "شوێنەکە سڕایەوە، بەڵام پاککردنەوەی هەندێک فایلی وێنە پێویستی بە دووبارە هەوڵدان هەیە.",
    notificationsMarkedRead: "هەموو ئاگادارکردنەوەکان وەک خوێندراو تۆمار کران.",
    readNotificationsDeleted: "ئاگادارکردنەوە خوێندراوە کۆنەکان سڕانەوە.",
    savingPlace: "تۆمارکردنی شوێن لە داتابەیس...",
    photoCompressing: "ئامادەکردن و کەمکردنەوەی قەبارەی وێنە...",
    photoCompressed: "وێنەکە بە کوالێتی بەرز ئامادە کرا.",
    photoUploadFailedSaved: "شوێنەکە پارێزرا و بۆ ڕیڤیو نێردرا، بەڵام وێنەکە بارنەکرا. لە هەمان دەستکاریکردنەوە دەتوانیت دووبارە هەوڵ بدەیت.",
    unavailable: "خزمەتی هەژمار و بەشداری ئێستا ڕێکنەخراوە."
  },
  ar: {
    title: "الحساب والمساهمات",
    subtitle: "سجّل الدخول عبر Google، اقترح مكاناً وتابع حالة المراجعة.",
    close: "إغلاق",
    signInTitle: "تسجيل الدخول عبر Google",
    signInBody: "يمكن لأي مستخدم اقتراح مكان؛ لا يتم نشر أي مكان قبل موافقة المشرف.",
    signInGoogle: "المتابعة باستخدام Google",
    legalPrefix: "بالمتابعة أنت توافق على",
    privacy: "سياسة الخصوصية",
    terms: "شروط الاستخدام",
    guidelines: "إرشادات المساهمة",
    dashboard: "لوحتي",
    addPlace: "اقتراح مكان",
    noPlaces: "لم تقترح أي مكان بعد.",
    notifications: "الإشعارات",
    noNotifications: "لا توجد إشعارات جديدة.",
    pending: "بانتظار المراجعة",
    approved: "مقبول",
    rejected: "يحتاج تعديلاً",
    withdrawn: "ملغي",
    edit: "تعديل",
    withdraw: "إلغاء الطلب",
    save: "إرسال للمراجعة",
    back: "رجوع",
    nameKu: "الاسم الكردي",
    nameAr: "الاسم العربي",
    nameEn: "English name",
    group: "الفئة الرئيسية",
    type: "نوع المكان التفصيلي",
    descriptionKu: "الوصف الكردي",
    descriptionAr: "الوصف العربي",
    descriptionEn: "English description",
    location: "الموقع والإحداثيات",
    pickMap: "اختيار من الخريطة",
    longitude: "خط الطول",
    latitude: "خط العرض",
    photo: "صورة اختيارية",
    captionKu: "تعليق كردي",
    captionAr: "تعليق عربي",
    captionEn: "English caption",
    chooseFile: "اختيار صورة",
    noFileChosen: "لم يتم اختيار صورة بعد",
    photoHelp: "JPEG أو PNG أو WebP فقط · 10 MB كحد أقصى لكل صورة · 12 صورة كحد أقصى لكل مكان",
    photoSelected: "الصورة المختارة",
    photoChange: "تغيير الصورة",
    photoRemove: "إزالة الصورة",
    photoDelete: "حذف الصورة",
    photoDeleteConfirm: "هل أنت متأكد من حذف هذه الصورة نهائياً؟ لا يمكن التراجع عن ذلك.",
    photoDeleted: "تم حذف الصورة بنجاح.",
    photoCleanupWarning: "تم حذف الصورة من القائمة، لكن ملف التخزين يحتاج إلى محاولة تنظيف إضافية.",
    invalidPhoto: "يسمح فقط بصور JPEG أو PNG أو WebP.",
    photoTooLarge: "يجب ألا يتجاوز حجم الصورة 10 MB.",
    characters: "حرف",
    words: "كلمة",
    arabicScriptHint: "حروف كردية/عربية فقط؛ الأرقام وعلامات الترقيم مسموحة.",
    latinScriptHint: "حروف لاتينية/إنجليزية فقط؛ الأرقام وعلامات الترقيم مسموحة.",
    fieldRequired: "هذا الحقل مطلوب.",
    wrongArabicScript: "هذا الحقل يقبل الحروف الكردية/العربية فقط.",
    wrongLatinScript: "هذا الحقل يقبل الحروف اللاتينية/الإنجليزية فقط.",
    characterLimitExceeded: "تم تجاوز الحد الأقصى للحروف.",
    wordLimitExceeded: "تم تجاوز الحد الأقصى للكلمات.",
    coordinateInvalid: "الإحداثيات غير صالحة.",
    coordinateRange: "يجب أن يكون الموقع داخل حدود خريطة NAV KURD.",
    uploadPreparing: "جارٍ تجهيز الطلب...",
    uploadingPhoto: "جارٍ رفع الصورة...",
    uploadComplete: "اكتمل",
    submitHint: "يُرسل المكان أولاً كمعلّق للمراجعة ولا يُنشر إلا بعد موافقة المشرف.",
    legalAccept: "قرأت وأوافق على سياسة الخصوصية والشروط وإرشادات المساهمة.",
    legalAcceptAction: "موافقة ومتابعة",
    legalRequired: "يجب قبول السياسة والشروط قبل إرسال مكان.",
    saved: "تم إرسال اقتراحك للمراجعة.",
    withdrawnMessage: "تم إلغاء طلبك.",
    signOut: "تسجيل الخروج",
    signOutConfirmTitle: "هل تريد تسجيل الخروج؟",
    signOutConfirmBody: "سيبقى حسابك محفوظًا، لكن جلسة تسجيل الدخول ستنتهي على هذا الجهاز. يمكنك تسجيل الدخول مجددًا عبر Google في أي وقت.",
    signOutConfirmAction: "نعم، تسجيل الخروج",
    account: "الحساب",
    deleteRequest: "حذف الحساب والبيانات",
    deletionRequested: "تم حذف حسابك وبياناتك الشخصية بنجاح.",
    deleteConfirm: "هل أنت متأكد؟ سيؤدي هذا إلى حذف حسابك وأماكنك وصورك وبياناتك الشخصية نهائياً ولا يمكن التراجع عنه.",
    adminBlocked: "حساب المشرف منفصل تماماً عن حساب المستخدم العادي. استخدم لوحة الإدارة لإدارة المحتوى.",
    revisionPending: "التعديل بانتظار المراجعة؛ تبقى النسخة المعتمدة السابقة ظاهرة للعامة.",
    revisionRejected: "تم رفض التعديل ويمكنك إصلاحه وإرساله للمراجعة من جديد.",
    revisionWithdrawn: "تم سحب التعديل ويمكنك تعديله وإرساله مرة أخرى.",
    search: "بحث",
    required: "مطلوب",
    optional: "اختياري",
    markAllRead: "تحديد الكل كمقروء",
    deleteReadNotifications: "حذف الإشعارات المقروءة",
    deletePlace: "حذف المكان",
    deletePlaceConfirm: "هل أنت متأكد من حذف هذا المكان نهائياً؟ سيتم حذف الصور والبيانات المرتبطة التي تملكها ولا يمكن التراجع عن ذلك.",
    deleteAccountTitle: "حذف الحساب والبيانات",
    confirmCancel: "إلغاء",
    confirmDelete: "حذف نهائي",
    deletePlaceSuccess: "تم حذف المكان والبيانات المرتبطة به بنجاح.",
    deletePlaceCleanupWarning: "تم حذف المكان، لكن بعض ملفات الصور تحتاج إلى محاولة تنظيف إضافية.",
    notificationsMarkedRead: "تم تحديد جميع الإشعارات كمقروءة.",
    readNotificationsDeleted: "تم حذف الإشعارات المقروءة القديمة.",
    savingPlace: "جارٍ حفظ المكان في قاعدة البيانات...",
    photoCompressing: "جارٍ تجهيز الصورة وتقليل حجمها...",
    photoCompressed: "تم تجهيز الصورة بجودة عالية.",
    photoUploadFailedSaved: "تم حفظ المكان وإرساله للمراجعة، لكن رفع الصورة لم يكتمل. يمكنك إعادة المحاولة من نفس شاشة التعديل.",
    unavailable: "خدمة الحساب والمساهمات غير مهيأة الآن."
  },
  en: {
    title: "Account & contributions",
    subtitle: "Sign in with Google, suggest places and follow the review status.",
    close: "Close",
    signInTitle: "Sign in with Google",
    signInBody: "Anyone can suggest a place; nothing is published until an administrator approves it.",
    signInGoogle: "Continue with Google",
    legalPrefix: "By continuing you agree to the",
    privacy: "Privacy Policy",
    terms: "Terms of Use",
    guidelines: "Contribution Guidelines",
    dashboard: "My dashboard",
    addPlace: "Suggest a place",
    noPlaces: "You have not suggested a place yet.",
    notifications: "Notifications",
    noNotifications: "No new notifications.",
    pending: "Pending review",
    approved: "Approved",
    rejected: "Needs changes",
    withdrawn: "Withdrawn",
    edit: "Edit",
    withdraw: "Withdraw",
    save: "Send for review",
    back: "Back",
    nameKu: "Kurdish name",
    nameAr: "Arabic name",
    nameEn: "English name",
    group: "Main category",
    type: "Detailed place type",
    descriptionKu: "Kurdish description",
    descriptionAr: "Arabic description",
    descriptionEn: "English description",
    location: "Location & coordinates",
    pickMap: "Pick on map",
    longitude: "Longitude",
    latitude: "Latitude",
    photo: "Optional photo",
    captionKu: "Kurdish caption",
    captionAr: "Arabic caption",
    captionEn: "English caption",
    chooseFile: "Choose image",
    noFileChosen: "No image selected yet",
    photoHelp: "JPEG, PNG or WebP only · maximum 10 MB per image · maximum 12 images per place",
    photoSelected: "Selected image",
    photoChange: "Change image",
    photoRemove: "Remove image",
    photoDelete: "Delete image",
    photoDeleteConfirm: "Permanently delete this image? This cannot be undone.",
    photoDeleted: "The image was deleted successfully.",
    photoCleanupWarning: "The image was removed from the list, but its stored file needs another cleanup attempt.",
    invalidPhoto: "Only JPEG, PNG or WebP images are allowed.",
    photoTooLarge: "The image must be 10 MB or smaller.",
    characters: "characters",
    words: "words",
    arabicScriptHint: "Kurdish/Arabic letters only; numbers and punctuation are allowed.",
    latinScriptHint: "Latin/English letters only; numbers and punctuation are allowed.",
    fieldRequired: "This field is required.",
    wrongArabicScript: "This field accepts Kurdish/Arabic letters only.",
    wrongLatinScript: "This field accepts Latin/English letters only.",
    characterLimitExceeded: "The character limit was exceeded.",
    wordLimitExceeded: "The word limit was exceeded.",
    coordinateInvalid: "The coordinates are not valid.",
    coordinateRange: "The location must be inside the NAV KURD map boundary.",
    uploadPreparing: "Preparing submission...",
    uploadingPhoto: "Uploading image...",
    uploadComplete: "Complete",
    submitHint: "Your place is submitted as Pending and is not published until an administrator approves it.",
    legalAccept: "I have read and accept the Privacy Policy, Terms of Use and Contribution Guidelines.",
    legalAcceptAction: "Accept and continue",
    legalRequired: "Accept the privacy policy and terms before submitting a place.",
    saved: "Your contribution was sent for review.",
    withdrawnMessage: "Your submission was withdrawn.",
    signOut: "Sign out",
    signOutConfirmTitle: "Sign out of NAV KURD?",
    signOutConfirmBody: "Your account remains intact, but this device session will end. You can sign in with Google again at any time.",
    signOutConfirmAction: "Yes, sign out",
    account: "Account",
    deleteRequest: "Delete account and data",
    deletionRequested: "Your account and personal data were deleted successfully.",
    deleteConfirm: "Are you sure? This permanently deletes your account, places, photos and personal data and cannot be undone.",
    adminBlocked: "Administrator accounts are strictly separated from ordinary-user accounts. Use Owner Studio for management.",
    revisionPending: "Your edit is pending review; the previously approved public version remains visible.",
    revisionRejected: "Your edit was rejected. You can correct it and submit a new revision for review.",
    revisionWithdrawn: "Your edit was withdrawn. You can edit and submit it again.",
    search: "Search",
    required: "Required",
    optional: "Optional",
    markAllRead: "Mark all as read",
    deleteReadNotifications: "Delete read notifications",
    deletePlace: "Delete place",
    deletePlaceConfirm: "Are you sure you want to permanently delete this place? Your related images and data will also be deleted and cannot be restored.",
    deleteAccountTitle: "Delete account and data",
    confirmCancel: "Cancel",
    confirmDelete: "Delete permanently",
    deletePlaceSuccess: "The place and its related data were deleted successfully.",
    deletePlaceCleanupWarning: "The place was deleted, but some image files need another cleanup attempt.",
    notificationsMarkedRead: "All notifications were marked as read.",
    readNotificationsDeleted: "Old read notifications were deleted.",
    savingPlace: "Saving the place to the database...",
    photoCompressing: "Preparing and reducing image size...",
    photoCompressed: "The image was prepared at high quality.",
    photoUploadFailedSaved: "The place was saved and sent for review, but the image upload did not complete. Retry from the same edit screen.",
    unavailable: "Account and contribution service is not configured."
  }
};

function reviewLabel(place: AtlasPlace, copy: Copy): string {
  const revision = place.active_revision;
  if (place.review_status === "approved" && revision?.review_status === "pending") return copy.revisionPending;
  if (place.review_status === "approved" && revision?.review_status === "rejected") return copy.revisionRejected;
  if (place.review_status === "approved" && revision?.review_status === "withdrawn") return copy.revisionWithdrawn;
  return place.review_status === "approved" ? copy.approved
    : place.review_status === "rejected" ? copy.rejected
    : place.review_status === "withdrawn" ? copy.withdrawn
    : copy.pending;
}

function notificationText(notification: AtlasNotification, language: StudioLanguage): { title: string; body: string } {
  return language === "ar"
    ? { title: notification.title_ar, body: notification.body_ar ?? "" }
    : language === "en"
      ? { title: notification.title_en, body: notification.body_en ?? "" }
      : { title: notification.title_ku, body: notification.body_ku ?? "" };
}

function taxonomyTags(category: string): string[] {
  return normalizeAtlasTags([
    category,
    atlasPlaceTypeGroup(category),
    ...atlasPlaceTypeSearchTerms(category).slice(0, 10).map((value) => value.toLocaleLowerCase("en-US").replace(/[\s-]+/g, "_"))
  ]);
}

function formatAtlasCoordinate(value: number | string): string {
  const numeric = Number(value);
  return Number.isFinite(numeric) ? numeric.toFixed(7) : "";
}

function formatFileSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  const kb = bytes / 1024;
  if (kb < 1024) return `${kb.toFixed(kb >= 100 ? 0 : 1)} KB`;
  const mb = kb / 1024;
  return `${mb.toFixed(mb >= 10 ? 1 : 2)} MB`;
}

function navigationHistoryCopy(language: StudioLanguage): { title: string; empty: string; arrived: string; cancelled: string; clear: string; delete: string; deleteTitle: string; deleteConfirm: string; clearTitle: string; clearConfirm: string; deleteAction: string; deleted: string; cleared: string } {
  if (language === "ar") return { title: "سجل الملاحة", empty: "لا توجد رحلات محفوظة بعد.", arrived: "وصلت", cancelled: "ملغاة", clear: "مسح السجل", delete: "حذف الرحلة", deleteTitle: "حذف رحلة محفوظة", deleteConfirm: "هل تريد حذف هذه الرحلة نهائياً من قاعدة البيانات ومن جميع أجهزتك؟", clearTitle: "مسح سجل الملاحة", clearConfirm: "هل تريد حذف سجل الملاحة بالكامل من قاعدة البيانات ومن جميع أجهزتك؟", deleteAction: "نعم، احذف", deleted: "تم حذف الرحلة من سجل الملاحة.", cleared: "تم مسح سجل الملاحة." };
  if (language === "en") return { title: "Navigation history", empty: "No saved journeys yet.", arrived: "Arrived", cancelled: "Cancelled", clear: "Clear history", delete: "Delete journey", deleteTitle: "Delete saved journey", deleteConfirm: "Permanently delete this journey from the database and all your devices?", clearTitle: "Clear navigation history", clearConfirm: "Permanently delete all navigation history from the database and all your devices?", deleteAction: "Yes, delete", deleted: "The journey was removed from navigation history.", cleared: "Navigation history was cleared." };
  return { title: "مێژووی ڕێنیشاندان", empty: "هێشتا هیچ گەشتێک تۆمار نەکراوە.", arrived: "گەیشتوو", cancelled: "هەڵوەشاوە", clear: "سڕینەوەی مێژوو", delete: "سڕینەوەی گەشت", deleteTitle: "سڕینەوەی گەشتی تۆمارکراو", deleteConfirm: "دڵنیایت ئەم گەشتە بە هەمیشەیی لە دیتابەیس و هەموو ئامێرەکانت بسڕیتەوە؟", clearTitle: "سڕینەوەی مێژووی ڕێنیشاندان", clearConfirm: "دڵنیایت هەموو مێژووی ڕێنیشاندان لە دیتابەیس و هەموو ئامێرەکانت بسڕیتەوە؟", deleteAction: "بەڵێ، بیسڕەوە", deleted: "گەشتەکە لە مێژووی ڕێنیشاندان سڕایەوە.", cleared: "مێژووی ڕێنیشاندان پاککرایەوە." };
}

function formatNavigationDistance(meters: number, language: StudioLanguage): string {
  const locale = language === "ar" ? "ar-IQ" : language === "en" ? "en-GB" : "ckb-IQ";
  const safeMeters = Math.max(0, Number.isFinite(meters) ? meters : 0);
  if (safeMeters < 1000) return `${Math.round(safeMeters).toLocaleString(locale)} m`;
  return `${(safeMeters / 1000).toLocaleString(locale, { maximumFractionDigits: 1 })} km`;
}

function formatNavigationElapsed(seconds: number, language: StudioLanguage): string {
  const safeSeconds = Math.max(0, Math.round(Number.isFinite(seconds) ? seconds : 0));
  const hours = Math.floor(safeSeconds / 3600);
  const minutes = Math.floor((safeSeconds % 3600) / 60);
  const locale = language === "ar" ? "ar-IQ" : language === "en" ? "en-GB" : "ckb-IQ";
  const parts = hours > 0 ? `${hours.toLocaleString(locale)}h ${minutes.toLocaleString(locale)}m` : `${Math.max(1, minutes).toLocaleString(locale)}m`;
  return parts;
}

function userIcon(name: "plus" | "back" | "chevron" | "pin" | "image" | "trash" | "readAll" | "bell" | "signout" | "places" | "messages" | "account"): string {
  const suppliedAssets: Partial<Record<typeof name, string>> = {
    trash: "delete",
    bell: "15",
    places: "13",
    messages: "14",
    account: "profile",
  };
  const supplied = suppliedAssets[name];
  if (supplied) {
    return `<img class="user-ui-icon user-ui-icon--asset" src="${appUrl(`assets/icons/nav-kurd/${supplied}.svg`)}" alt="" aria-hidden="true" draggable="false">`;
  }
  const paths: Record<string, string> = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    back: '<path d="M15 6l-6 6 6 6"/>',
    chevron: '<path d="m8 10 4 4 4-4"/>',
    pin: '<path d="M12 21s6-5.2 6-11a6 6 0 1 0-12 0c0 5.8 6 11 6 11Z"/><circle cx="12" cy="10" r="2.2"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="3"/><circle cx="9" cy="10" r="2"/><path d="m5 18 4.5-4.5 3.2 3.2 2.3-2.3L19 18"/>',
    readAll: '<path d="m3 12 4 4 6-7M11 16l2 2 8-10"/>',
    signout: '<path d="M10 5H5v14h5M14 8l4 4-4 4M18 12H9"/>',
  };
  return `<svg class="user-ui-icon" viewBox="0 0 24 24" fill="none" aria-hidden="true" focusable="false">${paths[name]}</svg>`;
}

function googleBrandIcon(): string {
  return `<svg class="user-google-icon" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><path fill="#4285F4" d="M21.6 12.23c0-.71-.06-1.4-.18-2.06H12v3.9h5.38a4.6 4.6 0 0 1-2 3.02v2.53h3.24c1.9-1.75 2.98-4.33 2.98-7.39Z"/><path fill="#34A853" d="M12 22c2.7 0 4.96-.9 6.62-2.38l-3.24-2.53c-.9.6-2.05.96-3.38.96-2.6 0-4.81-1.76-5.6-4.13H3.05v2.6A10 10 0 0 0 12 22Z"/><path fill="#FBBC05" d="M6.4 13.92A6 6 0 0 1 6.09 12c0-.67.11-1.32.31-1.92v-2.6H3.05A10 10 0 0 0 2 12c0 1.61.39 3.14 1.05 4.52l3.35-2.6Z"/><path fill="#EA4335" d="M12 5.95c1.47 0 2.79.5 3.83 1.5l2.87-2.87A9.62 9.62 0 0 0 12 2a10 10 0 0 0-8.95 5.48l3.35 2.6C7.19 7.71 9.4 5.95 12 5.95Z"/></svg>`;
}

function renderTextAssist(id: string, value: string, limit: AtlasTextLimit, script: AtlasScriptPolicy, copy: Copy): string {
  const chars = value.length;
  const words = countAtlasWords(value);
  const scriptHint = script === "arabic" ? copy.arabicScriptHint : copy.latinScriptHint;
  return `<div class="user-contrib__field-meta"><small>${escapeText(scriptHint)}</small><span data-field-counter-for="${escapeText(id)}">${chars}/${limit.maxChars} ${escapeText(copy.characters)} · ${words}/${limit.maxWords} ${escapeText(copy.words)}</span></div><p class="user-contrib__field-error" id="${escapeText(id)}Error" data-field-error-for="${escapeText(id)}" role="alert" hidden></p>`;
}


type UserPrivateCopy = {
  tabs: Record<UserDashboardTab, string>;
  messagesTitle: string;
  messagesEmpty: string;
  messagesHint: string;
  messageEdit: string;
  messageDelete: string;
  messageSave: string;
  messageCancel: string;
  messageUpdated: string;
  messageDeleted: string;
  messageEditLocked: string;
  adminReply: string;
  notificationDelete: string;
  notificationDeleted: string;
  deleteMessageConfirm: string;
  deleteNotificationConfirm: string;
};

function userPrivateCopy(language: StudioLanguage): UserPrivateCopy {
  if (language === "ar") return {
    tabs: { places: "أماكني", messages: "رسائلي", notifications: "الإشعارات", account: "حسابي" },
    messagesTitle: "رسائلي الخاصة",
    messagesEmpty: "لم ترسل أي رسالة أو تقرير بعد.",
    messagesHint: "يمكنك تعديل رسالتك قبل أن يبدأ المشرف بمعالجتها. تبقى إشعارات النظام غير قابلة للتعديل حفاظاً على السجل.",
    messageEdit: "تعديل",
    messageDelete: "حذف",
    messageSave: "حفظ التعديل",
    messageCancel: "إلغاء",
    messageUpdated: "تم تحديث رسالتك.",
    messageDeleted: "تم حذف رسالتك.",
    messageEditLocked: "بدأت معالجة هذه الرسالة؛ لا يمكن تعديل النص الآن.",
    adminReply: "رد الإدارة",
    notificationDelete: "حذف الإشعار",
    notificationDeleted: "تم حذف الإشعار.",
    deleteMessageConfirm: "هل تريد حذف هذه الرسالة نهائياً؟",
    deleteNotificationConfirm: "هل تريد حذف هذا الإشعار؟"
  };
  if (language === "en") return {
    tabs: { places: "My places", messages: "My messages", notifications: "Notifications", account: "Account" },
    messagesTitle: "Private messages",
    messagesEmpty: "You have not sent any message or report yet.",
    messagesHint: "You may edit your message before an administrator starts processing it. System notifications stay immutable to preserve the audit trail.",
    messageEdit: "Edit",
    messageDelete: "Delete",
    messageSave: "Save changes",
    messageCancel: "Cancel",
    messageUpdated: "Your message was updated.",
    messageDeleted: "Your message was deleted.",
    messageEditLocked: "An administrator has started processing this message, so its text can no longer be edited.",
    adminReply: "Administrator reply",
    notificationDelete: "Delete notification",
    notificationDeleted: "The notification was deleted.",
    deleteMessageConfirm: "Permanently delete this message?",
    deleteNotificationConfirm: "Delete this notification?"
  };
  return {
    tabs: { places: "شوێنەکانی من", messages: "نامەکانی من", notifications: "ئاگادارکردنەوەکان", account: "هەژماری من" },
    messagesTitle: "نامە تایبەتییەکانم",
    messagesEmpty: "هێشتا هیچ نامە یان ڕاپۆرتێکت نەناردووە.",
    messagesHint: "پێش ئەوەی بەڕێوەبەر دەست بە چارەسەرکردن بکات، دەتوانیت نامەکەت دەستکاری بکەیت. ئاگادارکردنەوە سیستەمییەکان بۆ پاراستنی مێژوو دەستکاری ناکرێن.",
    messageEdit: "دەستکاری",
    messageDelete: "سڕینەوە",
    messageSave: "پاراستنی دەستکاری",
    messageCancel: "پاشگەزبوونەوە",
    messageUpdated: "نامەکەت نوێ کرایەوە.",
    messageDeleted: "نامەکەت سڕایەوە.",
    messageEditLocked: "بەڕێوەبەر دەستی بە چارەسەرکردنی ئەم نامەیە کردووە؛ چیتر دەقەکە دەستکاری ناکرێت.",
    adminReply: "وەڵامی بەڕێوەبەر",
    notificationDelete: "سڕینەوەی ئاگادارکردنەوە",
    notificationDeleted: "ئاگادارکردنەوەکە سڕایەوە.",
    deleteMessageConfirm: "دڵنیایت دەتەوێت ئەم نامەیە بە هەمیشەیی بسڕیتەوە؟",
    deleteNotificationConfirm: "دڵنیایت دەتەوێت ئەم ئاگادارکردنەوەیە بسڕیتەوە؟"
  };
}

function feedbackCategoryLabel(category: AtlasFeedbackCategory, language: StudioLanguage): string {
  const labels: Record<AtlasFeedbackCategory, [string, string, string]> = {
    bug: ["گلیچ/هەڵە", "خلل/خطأ", "Bug/glitch"],
    data: ["داتای ماپ", "بيانات الخريطة", "Map data"],
    place: ["ناو/شوێن", "اسم/مكان", "Place/name"],
    search: ["گەڕان", "البحث", "Search"],
    login: ["چوونەژوورەوە", "تسجيل الدخول", "Sign-in"],
    offline: ["ئۆفلاین", "دون اتصال", "Offline"],
    gps: ["GPS/ڕێنیشاندان", "GPS/الملاحة", "GPS/navigation"],
    ui: ["UI/شاشە", "الواجهة/الشاشة", "UI/display"],
    other: ["شتی تر", "أخرى", "Other"]
  };
  return labels[category][language === "ar" ? 1 : language === "en" ? 2 : 0];
}

function feedbackStatusLabel(status: AtlasFeedback["status"], language: StudioLanguage): string {
  if (language === "ar") return status === "new" ? "جديد" : status === "in_progress" ? "قيد المعالجة" : status === "resolved" ? "تم الحل" : "مغلق";
  if (language === "en") return status === "new" ? "New" : status === "in_progress" ? "In progress" : status === "resolved" ? "Resolved" : "Closed";
  return status === "new" ? "نوێ" : status === "in_progress" ? "لەژێر چارەسەر" : status === "resolved" ? "چارەسەرکراو" : "داخراو";
}

function safeAvatarUrl(value: string | null | undefined): string | null {
  if (!value || value.length > 4096) return null;
  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" ? parsed.toString() : null;
  } catch {
    return null;
  }
}

export class UserContributionStudio {
  private readonly host: HTMLDivElement;
  private readonly options: UserStudioOptions;
  private identity: AtlasAuthIdentity | null = null;
  private profile: AtlasUserProfile | null = null;
  private places: AtlasPlace[] = [];
  private notifications: AtlasNotification[] = [];
  private feedback: AtlasFeedback[] = [];
  private navigationHistory: AtlasNavigationHistory[] = [];
  private activeDashboardTab: UserDashboardTab = "places";
  private editingFeedbackId: string | null = null;
  private editing: AtlasPlace | null = null;
  private coordinate: StudioCoordinate = [44.0, 36.0];
  private pendingNewPlaceCoordinate: StudioCoordinate | null = null;
  private view: UserStudioView = "signin";
  private busy = false;
  private message = "";
  private messageKind: "normal" | "success" | "error" = "normal";
  private choice: ChoiceKind = null;
  private editorDraft: Record<string, string> | null = null;
  private selectedGroup: string = ATLAS_TAXONOMY_GROUPS[0]?.id ?? "government_public";
  private selectedCategory: AtlasCategory = (ATLAS_TAXONOMY[0]?.id ?? "village") as AtlasCategory;
  private pendingPhotoFile: File | null = null;
  private photoPreviewUrl: string | null = null;
  private photoCompressionInfo = "";
  private photoProcessing = false;
  private photoPickerActive = false;
  private photoPickerReleaseTimer: number | null = null;
  private photoSelectionEpoch = 0;
  private photoPickerScroll: { panel: number; content: number } | null = null;
  private uploadProgress: number | null = null;
  private uploadStatus = "";
  private pendingConfirmation: UserPendingConfirmation = null;
  private accountDeleteAcknowledged = false;
  private refreshEpoch = 0;

  constructor(options: UserStudioOptions) {
    this.options = options;
    this.host = document.createElement("div");
    this.host.className = "user-contribution-studio";
    this.host.hidden = true;
    document.body.append(this.host);
    this.pendingNewPlaceCoordinate = this.loadPendingNewPlaceCoordinate();
    subscribeToAtlasAuth(() => { void this.handleAuthStateChange(); });
    subscribeToAtlasPlaces(() => {
      if (!this.identity || this.identity.role !== "user") return;
      if (!this.host.hidden) void this.refresh();
      else void this.syncNotifications();
    });
    window.addEventListener("pagehide", () => this.captureEditorDraft(), { passive: true });
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") {
        this.captureEditorDraft();
        return;
      }
      // Some Android document providers emit neither `change` nor `cancel`.
      // Once the WebView is visible again, the fallback restores the editor
      // instead of leaving its composited scroll layer blank.
      this.armPhotoPickerFallbackRestore();
    });
    window.addEventListener("focus", () => this.armPhotoPickerFallbackRestore());
    window.addEventListener("pageshow", () => this.armPhotoPickerFallbackRestore(), { passive: true });
    window.addEventListener("nav-kurd:native-resume", () => this.armPhotoPickerFallbackRestore());
    window.addEventListener("nav-kurd:navigation-history", () => {
      if (this.identity?.role === "user") void this.refreshNavigationHistory();
    });
    // A few document providers return without focus, visibility or cancel.
    // The next interaction in our panel is also proof that the chooser closed.
    this.host.addEventListener("pointerdown", () => {
      if (this.photoPickerActive && !this.photoProcessing) {
        this.restoreEditorAfterPhotoPicker(this.photoSelectionEpoch);
      }
    }, { capture: true, passive: true });
  }

  isOpen(): boolean { return !this.host.hidden; }
  isOpenOrBusy(): boolean { return !this.host.hidden || this.busy; }

  close(): void {
    this.captureEditorDraft();
    this.choice = null;
    this.host.hidden = true;
  }

  async handleAuthStateChange(): Promise<void> {
    // Refresh the complete account state even while the panel is closed. OAuth
    // callbacks can complete before this lazy module opens; keeping identity,
    // profile, role and notification state warm prevents stale sign-in copy.
    await this.refresh();
  }

  private draftKey(): string | null {
    return this.identity ? `nav-kurd-user-contribution-draft-v1:${this.identity.userId}` : null;
  }

  private loadStoredDraft(expectedId: string | null): Record<string, string> | null {
    const key = this.draftKey();
    if (!key) return null;
    try {
      const parsed = JSON.parse(localStorage.getItem(key) ?? "null") as { id?: string; values?: Record<string, string> } | null;
      if (!parsed?.values) return null;
      const draftId = String(parsed.id ?? "");
      if (draftId !== String(expectedId ?? "")) return null;
      return parsed.values;
    } catch { return null; }
  }

  private persistEditorDraft(values: Record<string, string>): void {
    this.editorDraft = values;
    const key = this.draftKey();
    if (!key) return;
    try { localStorage.setItem(key, JSON.stringify({ id: values.id ?? "", values, updatedAt: Date.now() })); } catch { /* private mode / quota */ }
  }

  private captureEditorDraft(): void {
    if (this.view !== "editor" || !this.identity) return;
    const form = this.host.querySelector<HTMLFormElement>('[data-user-form="place"]');
    if (!form) return;
    const values: Record<string, string> = {};
    const data = new FormData(form);
    for (const [name, value] of data.entries()) if (typeof value === "string") values[name] = value;
    values.category = this.selectedCategory;
    values.category_group = this.selectedGroup;
    this.persistEditorDraft(values);
  }

  private clearEditorDraft(): void {
    this.editorDraft = null;
    const key = this.draftKey();
    if (!key) return;
    try { localStorage.removeItem(key); } catch { /* private mode */ }
  }

  private loadPendingNewPlaceCoordinate(): StudioCoordinate | null {
    try {
      const parsed = JSON.parse(localStorage.getItem(PENDING_NEW_PLACE_STORAGE_KEY) ?? "null") as {
        coordinate?: unknown;
        updatedAt?: unknown;
      } | null;
      const coordinate = parsed?.coordinate;
      const updatedAt = Number(parsed?.updatedAt);
      if (!Array.isArray(coordinate) || coordinate.length !== 2 || !Number.isFinite(updatedAt)
        || Date.now() - updatedAt > PENDING_NEW_PLACE_MAX_AGE_MS) {
        localStorage.removeItem(PENDING_NEW_PLACE_STORAGE_KEY);
        return null;
      }
      const longitude = Number(coordinate[0]);
      const latitude = Number(coordinate[1]);
      if (!Number.isFinite(longitude) || !Number.isFinite(latitude)
        || longitude < -180 || longitude > 180 || latitude < -90 || latitude > 90) {
        localStorage.removeItem(PENDING_NEW_PLACE_STORAGE_KEY);
        return null;
      }
      return [longitude, latitude];
    } catch {
      return null;
    }
  }

  private persistPendingNewPlaceCoordinate(coordinate: StudioCoordinate): void {
    try {
      localStorage.setItem(PENDING_NEW_PLACE_STORAGE_KEY, JSON.stringify({ coordinate, updatedAt: Date.now() }));
    } catch { /* private mode / quota */ }
  }

  private clearPendingNewPlaceCoordinate(): void {
    this.pendingNewPlaceCoordinate = null;
    try { localStorage.removeItem(PENDING_NEW_PLACE_STORAGE_KEY); } catch { /* private mode */ }
  }

  private resumePendingNewPlace(): void {
    if (!this.identity || this.identity.role !== "user") return;
    this.pendingNewPlaceCoordinate ??= this.loadPendingNewPlaceCoordinate();
    if (!this.pendingNewPlaceCoordinate) return;
    this.host.hidden = false;
    if (!this.profile?.terms_accepted_at || !this.profile?.privacy_accepted_at) {
      this.view = "dashboard";
      this.message = this.copy().legalRequired;
      this.messageKind = "normal";
      this.render();
      return;
    }
    this.openNewPlace();
  }

  async syncRole(): Promise<AtlasAuthIdentity | null> {
    try {
      return await getAtlasAuthIdentity();
    } catch {
      return null;
    }
  }

  async open(): Promise<void> {
    this.host.hidden = false;
    this.render();
    await this.refresh();
  }

  openNewPlace(): void {
    if (!this.identity) { void this.open(); return; }
    if (this.identity.role === "admin") { this.host.hidden = true; void this.options.onAdminIdentity?.(); return; }
    if (!this.profile?.terms_accepted_at || !this.profile?.privacy_accepted_at) {
      this.message = COPY[this.options.getLanguage()].legalRequired;
      this.messageKind = "error";
      this.view = "dashboard";
      this.render();
      return;
    }
    this.editing = null;
    this.clearPendingPhoto();
    this.editorDraft = this.loadStoredDraft(null);
    this.pendingNewPlaceCoordinate ??= this.loadPendingNewPlaceCoordinate();
    const chosen = this.pendingNewPlaceCoordinate ?? [44.0, 36.0];
    this.clearPendingNewPlaceCoordinate();
    this.coordinate = [Number(formatAtlasCoordinate(chosen[0])), Number(formatAtlasCoordinate(chosen[1]))];
    if (this.editorDraft) {
      this.editorDraft.longitude = formatAtlasCoordinate(this.coordinate[0]);
      this.editorDraft.latitude = formatAtlasCoordinate(this.coordinate[1]);
    }
    this.selectedCategory = (atlasTaxonomyEntry(this.editorDraft?.category)?.id ?? ATLAS_TAXONOMY[0]?.id ?? "village") as AtlasCategory;
    this.selectedGroup = atlasPlaceTypeGroup(this.selectedCategory) || ATLAS_TAXONOMY_GROUPS[0].id;
    this.view = "editor";
    this.choice = null;
    this.message = "";
    this.render();
  }

  openNewPlaceAt(coordinate: StudioCoordinate): void {
    if (!Number.isFinite(coordinate[0]) || !Number.isFinite(coordinate[1])) return;
    this.pendingNewPlaceCoordinate = [coordinate[0], coordinate[1]];
    this.persistPendingNewPlaceCoordinate(this.pendingNewPlaceCoordinate);
    this.openNewPlace();
  }

  private copy(): Copy { return COPY[this.options.getLanguage()]; }

  private async syncNotifications(): Promise<void> {
    if (!this.identity || this.identity.role !== "user") {
      this.notifications = [];
      this.options.onUnreadCountChange?.(0);
      return;
    }
    try {
      this.notifications = await loadAtlasNotifications();
      this.options.onUnreadCountChange?.(this.notifications.filter((item) => !item.is_read).length);
    } catch {
      // Keep the last known unread indicator on transient network errors.
    }
  }

  private async loadSyncedNavigationHistory(): Promise<AtlasNavigationHistory[]> {
    if (!this.identity) return [];
    return loadSynchronizedNavigationHistory(this.identity.userId);
  }

  private async refreshNavigationHistory(): Promise<void> {
    if (!this.identity || this.identity.role !== "user") return;
    this.navigationHistory = await this.loadSyncedNavigationHistory();
    if (!this.host.hidden && this.view === "dashboard" && this.activeDashboardTab === "account") this.render();
  }

  private async refresh(): Promise<void> {
    const epoch = ++this.refreshEpoch;
    const oauthError = consumeAtlasOAuthCallbackError();
    if (!isAtlasBackendConfigured) {
      this.identity = null;
      this.view = "unavailable";
      this.render();
      return;
    }
    try {
      const previousUserId = this.identity?.userId ?? null;
      const nextIdentity = await getAtlasAuthIdentity();
      if (epoch !== this.refreshEpoch) return;
      this.identity = nextIdentity;
      if (!this.identity) {
        this.profile = null;
        this.places = [];
        this.notifications = [];
        this.feedback = [];
        this.navigationHistory = [];
        this.options.onUnreadCountChange?.(0);
        if (oauthError) {
          this.message = oauthError;
          this.messageKind = "error";
        }
        this.view = "signin";
        this.render();
        return;
      }
      if (this.identity.role === "admin") {
        this.profile = null;
        this.places = [];
        this.notifications = [];
        this.feedback = [];
        this.navigationHistory = [];
        this.options.onUnreadCountChange?.(0);
        this.editing = null;
        this.host.hidden = true;
        await this.options.onAdminIdentity?.();
        return;
      }
      if (previousUserId !== this.identity.userId) {
        this.profile = null;
        this.places = [];
        this.notifications = [];
        this.feedback = [];
        this.navigationHistory = [];
      }
      // The authenticated shell appears immediately from the local Supabase
      // session. Profile, places and notifications hydrate in parallel without
      // keeping the user behind a blank sign-in/loading surface.
      if (this.view !== "editor") {
        this.view = "dashboard";
        this.render();
      }
      const [profileResult, placesResult, notificationsResult, feedbackResult, navigationHistoryResult] = await Promise.allSettled([
        getAtlasUserProfile(this.identity),
        loadUserAtlasPlaces(this.identity),
        loadAtlasNotifications(),
        loadUserAtlasFeedback(),
        this.loadSyncedNavigationHistory()
      ]);
      if (epoch !== this.refreshEpoch) return;
      if (profileResult.status === "fulfilled") this.profile = profileResult.value;
      if (placesResult.status === "fulfilled") this.places = placesResult.value;
      if (notificationsResult.status === "fulfilled") this.notifications = notificationsResult.value;
      if (feedbackResult.status === "fulfilled") this.feedback = feedbackResult.value;
      if (navigationHistoryResult.status === "fulfilled") this.navigationHistory = navigationHistoryResult.value;
      this.options.onUnreadCountChange?.(this.notifications.filter((item) => !item.is_read).length);
      if (this.view !== "editor") this.view = "dashboard";
      if (this.messageKind === "error") {
        this.message = "";
        this.messageKind = "normal";
      }
      if (this.view === "editor") this.syncPhotoSelectionUi();
      else this.render();
      if (profileResult.status === "fulfilled") this.resumePendingNewPlace();
    } catch (error) {
      // A transient profile/place/notification failure must never impersonate a sign-out.
      // getAtlasAuthIdentity() already returns null for a genuinely missing auth session,
      // so preserve any verified session and the user's current editor state here.
      const hadVerifiedIdentity = Boolean(this.identity);
      if (!hadVerifiedIdentity) {
        this.profile = null;
        this.places = [];
        this.notifications = [];
        this.feedback = [];
        this.navigationHistory = [];
        this.editing = null;
        this.options.onUnreadCountChange?.(0);
        this.view = "signin";
      } else if (this.view !== "editor" && this.identity?.role === "user") {
        this.view = "dashboard";
      }
      this.message = atlasErrorMessage(error);
      this.messageKind = "error";
      if (this.view === "editor") this.syncPhotoSelectionUi();
      else this.render();
    }
  }

  private render(): void {
    if (this.view === "editor" && this.photoPickerActive) return;
    const previousPanel = this.host.querySelector<HTMLElement>(".user-contrib__panel");
    const previousContent = this.host.querySelector<HTMLElement>(".user-contrib__content");
    const previousPanelScroll = previousPanel?.scrollTop ?? 0;
    const previousContentScroll = previousContent?.scrollTop ?? 0;
    const language = this.options.getLanguage();
    const copy = this.copy();
    const body = this.view === "unavailable" ? `<p class="user-contrib__state">${escapeText(copy.unavailable)}</p>`
      : this.view === "admin-blocked" ? `<p class="user-contrib__state">${escapeText(copy.adminBlocked)}</p>`
      : this.view === "signin" ? this.renderSignIn(copy)
      : this.view === "editor" ? this.renderEditor(copy, language)
      : this.renderDashboard(copy, language);
    this.host.innerHTML = `
      <div class="user-contrib__backdrop" data-user-action="close"></div>
      <section class="user-contrib__panel" role="dialog" aria-modal="true" aria-labelledby="userContribTitle" dir="${languageDirection(language)}">
        <header class="user-contrib__header">
          <div><p>NAV KURD</p><h2 id="userContribTitle">${escapeText(copy.title)}</h2><span>${escapeText(copy.subtitle)}</span></div>
          <button class="dialog-close-button" type="button" data-user-action="close" aria-label="${escapeText(copy.close)}">${dialogCloseIcon()}</button>
        </header>
        ${this.message ? `<p class="user-contrib__message" data-kind="${this.messageKind}">${escapeText(this.message)}</p>` : ""}
        <div class="user-contrib__content">${body}</div>
      </section>
      ${this.renderChoice(language, copy)}
      ${this.renderConfirmation(copy, language)}
    `;
    this.attachEvents();
    // Re-rendering form choices must not throw the user back to the top.
    // Restore both possible scroll owners after the new DOM has been laid out.
    restoreClampedScroll(this.host, [
      { selector: ".user-contrib__panel", value: previousPanelScroll },
      { selector: ".user-contrib__content", value: previousContentScroll }
    ]);
  }

  private renderConfirmation(copy: Copy, language: StudioLanguage): string {
    const pending = this.pendingConfirmation;
    if (!pending) return "";
    const privateCopy = userPrivateCopy(language);
    const isSignOut = pending.kind === "signout";
    const isAccount = pending.kind === "delete-account";
    const isPlace = pending.kind === "delete-place";
    const isPhoto = pending.kind === "delete-photo";
    const isHistoryDelete = pending.kind === "delete-history";
    const isHistoryClear = pending.kind === "clear-history";
    const historyCopy = navigationHistoryCopy(language);
    const title = isSignOut ? copy.signOutConfirmTitle
      : isAccount ? copy.deleteAccountTitle
      : isPlace ? copy.deletePlace
      : isPhoto ? copy.photoDelete
      : isHistoryDelete ? historyCopy.deleteTitle
      : isHistoryClear ? historyCopy.clearTitle
      : pending.kind === "delete-feedback" ? privateCopy.messageDelete
      : privateCopy.notificationDelete;
    const detail = isSignOut ? copy.signOutConfirmBody
      : isAccount ? copy.deleteConfirm
      : isPlace ? copy.deletePlaceConfirm
      : isPhoto ? copy.photoDeleteConfirm
      : isHistoryDelete ? historyCopy.deleteConfirm
      : isHistoryClear ? historyCopy.clearConfirm
      : pending.kind === "delete-feedback" ? privateCopy.deleteMessageConfirm
      : privateCopy.deleteNotificationConfirm;
    const acknowledgement = language === "ar"
      ? "أفهم أن الحذف نهائي وسيتم تسجيل خروجي فور نجاحه."
      : language === "en"
        ? "I understand this is permanent and I will be signed out immediately after success."
        : "تێگەیشتم کە سڕینەوەکە هەمیشەییە و دوای سەرکەوتن یەکسەر دەچمە دەرەوە.";
    const accountDetails = !isAccount ? "" : `<ul class="user-confirm__data-list">
      <li>${escapeText(language === "ar" ? "الحساب وتسجيل الدخول" : language === "en" ? "Account and sign-in identity" : "هەژمار و ناسنامەی چوونەژوورەوە")}</li>
      <li>${escapeText(language === "ar" ? "الأماكن والتعديلات والصور" : language === "en" ? "Places, edits and uploaded images" : "شوێن، دەستکاری و وێنە بارکراوەکان")}</li>
      <li>${escapeText(language === "ar" ? "الرسائل والإشعارات والبيانات الخاصة" : language === "en" ? "Messages, notifications and private data" : "نامە، ئاگادارکردنەوە و داتای تایبەتی")}</li>
    </ul><label class="user-confirm__ack"><input type="checkbox" data-account-delete-ack ${this.accountDeleteAcknowledged ? "checked" : ""}><span>${escapeText(acknowledgement)}</span></label>`;
    return `<div class="user-confirm" role="presentation">
      <div class="user-confirm__backdrop" data-user-action="confirm-cancel"></div>
      <section class="user-confirm__panel" role="alertdialog" aria-modal="true" aria-labelledby="userConfirmTitle" aria-describedby="userConfirmMessage" dir="${languageDirection(language)}">
        <div class="user-confirm__icon ${isSignOut ? "is-signout" : ""}" aria-hidden="true">${userIcon(isSignOut ? "signout" : "trash")}</div>
        <p class="user-confirm__eyebrow">NAV KURD</p>
        <h3 id="userConfirmTitle">${escapeText(title)}</h3>
        <p id="userConfirmMessage">${escapeText(detail)}</p>
        ${accountDetails}
        <div class="user-confirm__actions">
          <button type="button" class="user-confirm__cancel" data-user-action="confirm-cancel" ${this.busy ? "disabled" : ""}>${escapeText(copy.confirmCancel)}</button>
          <button type="button" class="user-confirm__delete ${isSignOut ? "is-signout" : ""}" data-user-action="confirm-proceed" ${(this.busy || (isAccount && !this.accountDeleteAcknowledged)) ? "disabled" : ""}>${userIcon(isSignOut ? "signout" : "trash")}<span>${escapeText(isSignOut ? copy.signOutConfirmAction : (isHistoryDelete || isHistoryClear) ? historyCopy.deleteAction : copy.confirmDelete)}</span></button>
        </div>
      </section>
    </div>`;
  }

  private renderSignIn(copy: Copy): string {
    const language = this.options.getLanguage();
    return `<section class="user-contrib__signin">
      <div class="user-contrib__signin-mark" aria-hidden="true">${googleBrandIcon()}</div>
      <h3>${escapeText(copy.signInTitle)}</h3>
      <p>${escapeText(copy.signInBody)}</p>
      <button class="user-contrib__google" type="button" data-user-action="google-signin" ${this.busy ? "disabled" : ""}><span>${googleBrandIcon()}</span>${escapeText(copy.signInGoogle)}</button>
      <small>${escapeText(copy.legalPrefix)} <a href="${localizedLegalUrl("legal/privacy.html", language)}" target="_blank" rel="noopener">${escapeText(copy.privacy)}</a>، <a href="${localizedLegalUrl("legal/terms.html", language)}" target="_blank" rel="noopener">${escapeText(copy.terms)}</a> و <a href="${localizedLegalUrl("legal/contribution-guidelines.html", language)}" target="_blank" rel="noopener">${escapeText(copy.guidelines)}</a>.</small>
    </section>`;
  }

  private renderDashboard(copy: Copy, language: StudioLanguage): string {
    const privateCopy = userPrivateCopy(language);
    const displayName = this.identity?.displayName || this.identity?.email || copy.account;
    const avatarUrl = safeAvatarUrl(this.profile?.avatar_url ?? this.identity?.avatarUrl);
    const avatar = `<span class="user-account-card__avatar-fallback" aria-hidden="true">${userIcon("account")}</span>${avatarUrl ? `<img src="${escapeText(avatarUrl)}" alt="" referrerpolicy="no-referrer" loading="eager" decoding="async" data-user-avatar>` : ""}`;
    const legalAccepted = Boolean(this.profile?.terms_accepted_at && this.profile?.privacy_accepted_at);
    const places = this.places.map((place) => {
      const revision = place.active_revision;
      const hasPendingRevision = place.review_status === "approved" && revision?.review_status === "pending";
      const canEdit = !hasPendingRevision;
      const canWithdrawSubmission = ["pending", "rejected"].includes(place.review_status);
      const canWithdrawApproved = place.review_status === "approved" && place.status === "published" && !hasPendingRevision;
      const canWithdrawRevision = hasPendingRevision;
      const preview = atlasPlaceWithRevisionPreview(place);
      const note = revision && ["rejected", "withdrawn"].includes(revision.review_status) ? revision.review_note : place.review_note;
      return `<article class="user-submission" data-review="${escapeText(hasPendingRevision ? "revision-pending" : place.review_status)}">
        <img src="${escapeText(atlasMarkerAssetUrl(preview.category))}" alt="" aria-hidden="true">
        <div><strong>${escapeText(ownerName(preview, language))}</strong><span>${escapeText(reviewLabel(place, copy))}</span>${note ? `<small>${escapeText(note)}</small>` : ""}</div>
        <div class="user-submission__actions">
          ${canEdit ? `<button type="button" data-user-action="edit" data-id="${escapeText(place.id)}">${escapeText(copy.edit)}</button>` : ""}
          ${canWithdrawSubmission ? `<button type="button" data-user-action="withdraw" data-id="${escapeText(place.id)}">${escapeText(copy.withdraw)}</button>` : ""}
          ${canWithdrawApproved ? `<button type="button" data-user-action="withdraw-approved" data-id="${escapeText(place.id)}">${escapeText(copy.withdraw)}</button>` : ""}
          ${canWithdrawRevision ? `<button type="button" data-user-action="withdraw-revision" data-id="${escapeText(revision.id)}">${escapeText(copy.withdraw)}</button>` : ""}
          <button class="user-submission__delete" type="button" data-user-action="delete-place" data-id="${escapeText(place.id)}">${userIcon("trash")}<span>${escapeText(copy.deletePlace)}</span></button>
        </div>
      </article>`;
    }).join("") || `<p class="user-contrib__empty">${escapeText(copy.noPlaces)}</p>`;

    const feedbackRows = this.feedback.map((item) => {
      const editable = item.status === "new";
      const isEditing = this.editingFeedbackId === item.id && editable;
      const date = new Date(item.updated_at || item.created_at).toLocaleString(language === "ar" ? "ar-IQ" : language === "en" ? "en-GB" : "ckb-IQ");
      if (isEditing) {
        const categories = (["bug","data","place","search","login","offline","gps","ui","other"] as AtlasFeedbackCategory[])
          .map((category) => `<option value="${category}" ${category === item.category ? "selected" : ""}>${escapeText(feedbackCategoryLabel(category, language))}</option>`)
          .join("");
        return `<form class="user-private-message user-private-message--editing" data-user-feedback-form data-id="${escapeText(item.id)}">
          <div class="user-private-message__heading"><strong>${escapeText(privateCopy.messagesTitle)}</strong><span>${escapeText(feedbackStatusLabel(item.status, language))}</span></div>
          <label><span>${escapeText(copy.type)}</span><select name="category">${categories}</select></label>
          <label><span>${escapeText(privateCopy.messagesTitle)}</span><textarea name="message" minlength="20" maxlength="2000" required>${escapeText(item.message)}</textarea><small>${item.message.length}/2000</small></label>
          <div class="user-private-message__actions"><button type="submit">${escapeText(privateCopy.messageSave)}</button><button type="button" data-user-action="feedback-cancel">${escapeText(privateCopy.messageCancel)}</button></div>
        </form>`;
      }
      return `<article class="user-private-message" data-status="${escapeText(item.status)}">
        <div class="user-private-message__heading"><strong>${escapeText(feedbackCategoryLabel(item.category, language))}</strong><span>${escapeText(feedbackStatusLabel(item.status, language))}</span></div>
        <p>${escapeText(item.message)}</p>
        ${item.admin_note ? `<aside><strong>${escapeText(privateCopy.adminReply)}</strong><p>${escapeText(item.admin_note)}</p></aside>` : ""}
        <small>${escapeText(date)}</small>
        <div class="user-private-message__actions">
          ${editable ? `<button type="button" data-user-action="feedback-edit" data-id="${escapeText(item.id)}">${escapeText(privateCopy.messageEdit)}</button>` : `<span>${escapeText(privateCopy.messageEditLocked)}</span>`}
          <button type="button" class="is-danger" data-user-action="feedback-delete" data-id="${escapeText(item.id)}">${userIcon("trash")}<span>${escapeText(privateCopy.messageDelete)}</span></button>
        </div>
      </article>`;
    }).join("") || `<p class="user-contrib__empty">${escapeText(privateCopy.messagesEmpty)}</p>`;

    const unreadCount = this.notifications.filter((item) => !item.is_read).length;
    const readCount = this.notifications.length - unreadCount;
    const notifications = this.notifications.slice(0, 100).map((notification) => {
      const text = notificationText(notification, language);
      return `<article class="user-notification ${notification.is_read ? "is-read" : "is-unread"}">
        <button class="user-notification__read" type="button" data-user-action="notification-read" data-id="${escapeText(notification.id)}" aria-pressed="${notification.is_read ? "true" : "false"}">
          <span class="user-notification__icon" aria-hidden="true">${userIcon("bell")}</span>
          <span class="user-notification__copy"><strong>${escapeText(text.title)}</strong><span>${escapeText(text.body)}</span></span>
        </button>
        <button class="user-notification__delete" type="button" data-user-action="notification-delete" data-id="${escapeText(notification.id)}" aria-label="${escapeText(privateCopy.notificationDelete)}">${userIcon("trash")}</button>
      </article>`;
    }).join("") || `<p class="user-contrib__empty">${escapeText(copy.noNotifications)}</p>`;

    const notificationActions = unreadCount > 0 || readCount > 0
      ? `<div class="user-contrib__notification-actions">
          ${unreadCount > 0 ? `<button type="button" data-user-action="notifications-read-all">${userIcon("readAll")}<span>${escapeText(copy.markAllRead)}</span></button>` : ""}
          ${readCount > 0 ? `<button type="button" data-user-action="notifications-delete-read">${userIcon("trash")}<span>${escapeText(copy.deleteReadNotifications)}</span></button>` : ""}
        </div>`
      : "";

    const historyCopy = navigationHistoryCopy(language);
    const historyLocale = language === "ar" ? "ar-IQ" : language === "en" ? "en-GB" : "ckb-IQ";
    const navigationHistory = this.navigationHistory;
    const navigationHistoryRows = navigationHistory.map((entry) => {
      const distance = entry.status === "arrived"
        ? entry.planned_distance_meters
        : Math.max(0, entry.planned_distance_meters - entry.remaining_distance_meters);
      const date = new Intl.DateTimeFormat(historyLocale, { dateStyle: "medium", timeStyle: "short" }).format(new Date(entry.ended_at));
      return `<article class="user-navigation-history__item" data-status="${entry.status}">
        <i aria-hidden="true">${userIcon("pin")}</i>
        <div><strong>${escapeText(entry.destination)}</strong><span>${escapeText(date)}</span></div>
        <small>${escapeText(formatNavigationDistance(distance, language))} · ${escapeText(formatNavigationElapsed(entry.elapsed_seconds, language))}</small>
        <b>${escapeText(entry.status === "arrived" ? historyCopy.arrived : historyCopy.cancelled)}</b>
        <button type="button" class="user-navigation-history__delete" data-user-action="history-delete" data-id="${escapeText(entry.id)}" aria-label="${escapeText(historyCopy.delete)}" title="${escapeText(historyCopy.delete)}">${userIcon("trash")}</button>
      </article>`;
    }).join("") || `<p class="user-navigation-history__empty">${escapeText(historyCopy.empty)}</p>`;
    const navigationHistoryPanel = `<section class="user-navigation-history"><header><h3>${escapeText(historyCopy.title)}</h3><span>${navigationHistory.length}</span>${navigationHistory.length > 0 ? `<button type="button" data-user-action="history-clear">${userIcon("trash")}<span>${escapeText(historyCopy.clear)}</span></button>` : ""}</header><div>${navigationHistoryRows}</div></section>`;

    const placesPanel = `<section class="user-contrib__private-panel" data-private-panel="places">
      ${!legalAccepted ? `<section class="user-legal-accept"><label><input id="atlasLegalAccept" name="atlas_legal_accept" type="checkbox"><span>${escapeText(copy.legalAccept)}</span></label><p><a href="${localizedLegalUrl("legal/privacy.html", language)}" target="_blank" rel="noopener">${escapeText(copy.privacy)}</a> · <a href="${localizedLegalUrl("legal/terms.html", language)}" target="_blank" rel="noopener">${escapeText(copy.terms)}</a> · <a href="${localizedLegalUrl("legal/contribution-guidelines.html", language)}" target="_blank" rel="noopener">${escapeText(copy.guidelines)}</a></p><button type="button" data-user-action="legal-accept">${escapeText(copy.legalAcceptAction)}</button></section>` : `<button class="user-contrib__add" type="button" data-user-action="add">${userIcon("plus")}<span>${escapeText(copy.addPlace)}</span></button>`}
      <section class="user-contrib__section"><h3>${escapeText(privateCopy.tabs.places)} <span>${this.places.length}</span></h3><div class="user-contrib__list">${places}</div></section>
    </section>`;
    const messagesPanel = `<section class="user-contrib__private-panel" data-private-panel="messages"><header class="user-private-section__header"><div><h3>${escapeText(privateCopy.messagesTitle)}</h3><p>${escapeText(privateCopy.messagesHint)}</p></div><span>${this.feedback.length}</span></header><div class="user-private-message-list">${feedbackRows}</div></section>`;
    const notificationsPanel = `<section class="user-contrib__private-panel" data-private-panel="notifications"><section class="user-contrib__section"><h3>${escapeText(copy.notifications)} <span>${unreadCount}</span></h3>${notificationActions}<div class="user-contrib__notifications">${notifications}</div></section></section>`;
    const accountPanel = `<section class="user-contrib__private-panel" data-private-panel="account">
      <div class="user-account-private"><h3>${escapeText(privateCopy.tabs.account)}</h3><p>${escapeText(this.identity?.email ?? "")}</p></div>
      ${navigationHistoryPanel}
      <section class="user-contrib__privacy-actions"><a href="${localizedLegalUrl("legal/privacy.html", language)}" target="_blank" rel="noopener" data-legal-kind="privacy">${escapeText(copy.privacy)}</a><a href="${localizedLegalUrl("legal/terms.html", language)}" target="_blank" rel="noopener" data-legal-kind="terms">${escapeText(copy.terms)}</a><a href="${localizedLegalUrl("legal/contribution-guidelines.html", language)}" target="_blank" rel="noopener" data-legal-kind="guidelines">${escapeText(copy.guidelines)}</a><button type="button" data-user-action="signout" data-account-action="signout">${userIcon("signout")}<span>${escapeText(copy.signOut)}</span></button><button type="button" data-user-action="delete-request" data-account-action="delete">${userIcon("trash")}<span>${escapeText(copy.deleteRequest)}</span></button></section>
    </section>`;
    const panel = this.activeDashboardTab === "messages" ? messagesPanel
      : this.activeDashboardTab === "notifications" ? notificationsPanel
      : this.activeDashboardTab === "account" ? accountPanel
      : placesPanel;

    return `<div class="user-contrib__dashboard">
      <section class="user-account-card"><div class="user-account-card__avatar" data-user-avatar-shell>${avatar}</div><div class="user-account-card__identity"><strong>${escapeText(displayName)}</strong><span>${escapeText(this.identity?.email ?? "")}</span></div><button class="user-account-card__signout" type="button" data-user-action="signout" aria-label="${escapeText(copy.signOut)}">${userIcon("signout")}<span>${escapeText(copy.signOut)}</span></button></section>
      <nav class="user-private-tabs" aria-label="${escapeText(copy.dashboard)}">
        ${(Object.keys(privateCopy.tabs) as UserDashboardTab[]).map((tab) => `<button type="button" data-user-action="dashboard-tab" data-id="${tab}" class="${this.activeDashboardTab === tab ? "is-active" : ""}" aria-pressed="${this.activeDashboardTab === tab ? "true" : "false"}"><i aria-hidden="true">${userIcon(tab === "places" ? "places" : tab === "messages" ? "messages" : tab === "notifications" ? "bell" : "account")}</i><span>${escapeText(privateCopy.tabs[tab])}</span>${tab === "places" ? `<b>${this.places.length}</b>` : tab === "messages" ? `<b>${this.feedback.length}</b>` : tab === "notifications" ? `<b>${unreadCount}</b>` : ""}</button>`).join("")}
      </nav>
      ${panel}
    </div>`;
  }

  private renderEditor(copy: Copy, language: StudioLanguage): string {
    const place = this.editing;
    const canUploadPhoto = !place || (place.submission_source === "user" && place.status === "draft" && place.review_status !== "approved");
    const value = (name: string, fallback = ""): string => this.editorDraft?.[name] ?? fallback;
    const category = atlasTaxonomyEntry(this.editorDraft?.category)?.id ?? atlasTaxonomyEntry(place?.category)?.id ?? this.selectedCategory;
    this.selectedCategory = category as AtlasCategory;
    this.selectedGroup = this.editorDraft?.category_group || atlasPlaceTypeGroup(category) || this.selectedGroup;
    const groupLabel = ATLAS_TAXONOMY_GROUPS.find((group) => group.id === this.selectedGroup)?.label[language] ?? this.selectedGroup;
    const typeLabel = atlasTaxonomyEntry(category)?.label[language] ?? category;

    const textField = (
      id: string,
      name: string,
      label: string,
      fieldValue: string,
      limit: AtlasTextLimit,
      script: AtlasScriptPolicy,
      options: { required?: boolean; textarea?: boolean; rows?: number } = {}
    ): string => {
      const required = options.required ? ` required` : "";
      const tag = options.textarea ? "textarea" : "input";
      const rows = options.textarea ? ` rows="${options.rows ?? 4}"` : "";
      const lang = script === "latin" ? "en" : name.endsWith("_ar") ? "ar" : "ckb";
      const dir = script === "latin" ? "ltr" : "rtl";
      const aria = `${id}Assist ${id}Error`;
      const control = tag === "textarea"
        ? `<textarea id="${id}" name="${name}"${rows} lang="${lang}" dir="${dir}" data-atlas-script="${script}" ${atlasLimitAttributes(limit)} aria-describedby="${aria}"${required}>${escapeText(fieldValue)}</textarea>`
        : `<input id="${id}" name="${name}" value="${escapeText(fieldValue)}" lang="${lang}" dir="${dir}" data-atlas-script="${script}" ${atlasLimitAttributes(limit)} aria-describedby="${aria}"${required}>`;
      return `<label class="user-contrib__field"><span>${escapeText(label)} · ${escapeText(options.required ? copy.required : copy.optional)}</span>${control}<div id="${id}Assist">${renderTextAssist(id, fieldValue, limit, script, copy)}</div></label>`;
    };

    const longitude = formatAtlasCoordinate(value("longitude", String(place?.longitude ?? this.coordinate[0])));
    const latitude = formatAtlasCoordinate(value("latitude", String(place?.latitude ?? this.coordinate[1])));
    const selectedFileName = this.pendingPhotoFile?.name ?? copy.noFileChosen;
    const selectedFileSize = this.pendingPhotoFile ? formatFileSize(this.pendingPhotoFile.size) : "";
    const preview = `<div class="user-contrib__file-preview" data-user-photo-preview${this.photoPreviewUrl ? "" : " hidden"}><img${this.photoPreviewUrl ? ` src="${escapeText(this.photoPreviewUrl)}"` : ""} alt="${escapeText(copy.photoSelected)}"><div class="user-contrib__file-preview-actions"><label for="userPlacePhoto">${escapeText(copy.photoChange)}</label><button type="button" data-user-action="photo-clear">${userIcon("trash")}<span>${escapeText(copy.photoRemove)}</span></button></div></div>`;
    const managedPhotos = place ? orderedAtlasPhotos(place).map((photo) => {
      const mediaUrl = safeAvatarUrl(photo.media_url);
      if (!mediaUrl) return "";
      return `<article class="user-contrib__managed-photo"><img src="${escapeText(mediaUrl)}" alt="${escapeText(photo.caption_ku || photo.caption_ar || photo.caption_en || copy.photoSelected)}" loading="lazy" decoding="async"><button type="button" data-user-action="photo-delete" data-id="${escapeText(photo.id)}">${userIcon("trash")}<span>${escapeText(copy.photoDelete)}</span></button></article>`;
    }).join("") : "";
    const progressVisible = this.uploadProgress !== null || Boolean(this.uploadStatus);
    const progressHidden = progressVisible ? "" : " hidden";
    const numericProgress = this.uploadProgress ?? 0;
    const progressValue = this.uploadProgress === null ? "" : ` value="${Math.max(0, Math.min(100, numericProgress))}"`;
    const progressPercent = this.uploadProgress === null ? "" : `${Math.round(numericProgress)}%`;

    return `<form class="user-contrib__editor" data-user-form="place" novalidate>
      <input type="hidden" name="id" value="${escapeText(value("id", place?.id ?? ""))}">
      <input type="hidden" name="category_group" value="${escapeText(this.selectedGroup)}">
      <input type="hidden" name="category" value="${escapeText(category)}">
      <div class="user-contrib__editor-head"><button type="button" data-user-action="back">${userIcon("back")}<span>${escapeText(copy.back)}</span></button><p>${escapeText(copy.submitHint)}</p></div>
      <section class="user-contrib__form-section">
        <h3>${escapeText(copy.type)}</h3>
        <button class="user-choice-trigger" type="button" data-user-action="choice-group"><img src="${escapeText(atlasMarkerAssetUrl(category))}" alt=""><span><small>${escapeText(copy.group)}</small><strong>${escapeText(groupLabel)}</strong></span><b>${userIcon("chevron")}</b></button>
        <button class="user-choice-trigger" type="button" data-user-action="choice-type"><img src="${escapeText(atlasMarkerAssetUrl(category))}" alt=""><span><small>${escapeText(copy.type)}</small><strong>${escapeText(typeLabel)}</strong></span><b>${userIcon("chevron")}</b></button>
      </section>
      <section class="user-contrib__form-section">
        <h3>${escapeText(copy.nameKu)}</h3>
        ${textField("userPlaceNameKu", "name_ku", copy.nameKu, value("name_ku", place?.name_ku ?? ""), ATLAS_TEXT_LIMITS.name, "kurdish", { required: true })}
        ${textField("userPlaceNameAr", "name_ar", copy.nameAr, value("name_ar", place?.name_ar ?? ""), ATLAS_TEXT_LIMITS.name, "arabic")}
        ${textField("userPlaceNameEn", "name_en", copy.nameEn, value("name_en", place?.name_en ?? ""), ATLAS_TEXT_LIMITS.name, "latin")}
      </section>
      <section class="user-contrib__form-section">
        <h3>${escapeText(copy.descriptionKu)}</h3>
        ${textField("userPlaceDescKu", "description_ku", copy.descriptionKu, value("description_ku", place?.description_ku ?? ""), ATLAS_TEXT_LIMITS.description, "kurdish", { textarea: true, rows: 5 })}
        ${textField("userPlaceDescAr", "description_ar", copy.descriptionAr, value("description_ar", place?.description_ar ?? ""), ATLAS_TEXT_LIMITS.description, "arabic", { textarea: true, rows: 4 })}
        ${textField("userPlaceDescEn", "description_en", copy.descriptionEn, value("description_en", place?.description_en ?? ""), ATLAS_TEXT_LIMITS.description, "latin", { textarea: true, rows: 4 })}
      </section>
      <section class="user-contrib__form-section">
        <h3>${escapeText(copy.location)}</h3>
        <button class="user-contrib__map-pick" type="button" data-user-action="pick-map">${userIcon("pin")}<span>${escapeText(copy.pickMap)}</span></button>
        <div class="user-contrib__coords">
          <label class="user-contrib__field"><span>${escapeText(copy.longitude)}</span><input id="userPlaceLongitude" name="longitude" type="number" inputmode="decimal" step="any" min="42.18" max="46.5" value="${escapeText(longitude)}" required aria-describedby="userPlaceLongitudeError"><p class="user-contrib__field-error" id="userPlaceLongitudeError" data-field-error-for="userPlaceLongitude" role="alert" hidden></p></label>
          <label class="user-contrib__field"><span>${escapeText(copy.latitude)}</span><input id="userPlaceLatitude" name="latitude" type="number" inputmode="decimal" step="any" min="34.22" max="37.47" value="${escapeText(latitude)}" required aria-describedby="userPlaceLatitudeError"><p class="user-contrib__field-error" id="userPlaceLatitudeError" data-field-error-for="userPlaceLatitude" role="alert" hidden></p></label>
        </div>
      </section>
      ${canUploadPhoto ? `<section class="user-contrib__form-section user-contrib__media-section"><h3>${escapeText(copy.photo)}</h3>
        <div class="user-contrib__file-card">
          <label class="user-contrib__file-picker" for="userPlacePhoto"><span class="user-contrib__file-icon" aria-hidden="true">${userIcon("image")}</span><strong>${escapeText(copy.chooseFile)}</strong><small>${escapeText(copy.photoHelp)}</small><input class="user-contrib__file-input" id="userPlacePhoto" name="photo_file" type="file" accept="${escapeText(ATLAS_MEDIA_POLICY.accept)}" aria-label="${escapeText(copy.chooseFile)}" data-user-photo-input ${this.photoProcessing ? "disabled" : ""}></label>
          <div class="user-contrib__file-status" data-user-file-status><span>${escapeText(selectedFileName)}</span>${selectedFileSize ? `<b>${escapeText(selectedFileSize)}</b>` : ""}${this.photoCompressionInfo ? `<small>${escapeText(this.photoCompressionInfo)}</small>` : ""}</div>
          <p class="user-contrib__field-error" id="userPlacePhotoError" data-field-error-for="userPlacePhoto" role="alert" hidden></p>
          ${preview}
        </div>
        ${managedPhotos ? `<div class="user-contrib__managed-photos">${managedPhotos}</div>` : ""}
        ${textField("userPhotoCaptionKu", "caption_ku", copy.captionKu, value("caption_ku"), ATLAS_TEXT_LIMITS.caption, "kurdish")}
        ${textField("userPhotoCaptionAr", "caption_ar", copy.captionAr, value("caption_ar"), ATLAS_TEXT_LIMITS.caption, "arabic")}
        ${textField("userPhotoCaptionEn", "caption_en", copy.captionEn, value("caption_en"), ATLAS_TEXT_LIMITS.caption, "latin")}
      </section>` : ""}
      <div class="user-contrib__upload-progress" data-user-upload-progress${progressHidden} role="status" aria-live="polite">
        <div><span data-user-upload-status>${escapeText(this.uploadStatus || copy.uploadPreparing)}</span><b data-user-upload-percent>${escapeText(progressPercent)}</b></div>
        <progress max="100"${progressValue}></progress>
      </div>
      <button class="user-contrib__submit" type="submit" ${this.busy || this.photoProcessing ? "disabled" : ""}>${escapeText(copy.save)}</button>
    </form>`;
  }

  private renderChoice(language: StudioLanguage, copy: Copy): string {
    if (!this.choice) return "";
    const isGroup = this.choice === "group";
    const options = isGroup
      ? ATLAS_TAXONOMY_GROUPS.map((group) => {
          const firstType = ATLAS_TAXONOMY.find((entry) => entry.group === group.id)?.id ?? "other";
          return { id: group.id, label: group.label[language], search: `${group.label.ku} ${group.label.ar} ${group.label.en}`, icon: atlasMarkerAssetUrl(firstType) };
        })
      : ATLAS_TAXONOMY.filter((entry) => entry.group === this.selectedGroup).map((entry) => ({ id: entry.id, label: entry.label[language], search: `${entry.label.ku} ${entry.label.ar} ${entry.label.en} ${entry.aliases.join(" ")}`, icon: atlasMarkerAssetUrl(entry.id) }));
    return `<div class="user-choice"><div class="user-choice__backdrop" data-user-action="choice-close"></div><section class="user-choice__panel" role="dialog" aria-modal="true" dir="${languageDirection(language)}"><header><h3>${escapeText(isGroup ? copy.group : copy.type)}</h3><button class="dialog-close-button" type="button" data-user-action="choice-close" aria-label="${escapeText(copy.close)}">${dialogCloseIcon()}</button></header><label><span class="visually-hidden">${escapeText(copy.search)}</span><input id="userChoiceSearch" name="user_choice_search" type="search" placeholder="${escapeText(copy.search)}" data-user-choice-search autocomplete="off"></label><div class="user-choice__list">${options.map((option) => `<button type="button" data-user-action="choice-select" data-id="${escapeText(option.id)}" data-search="${escapeText(option.search.toLocaleLowerCase("en-US"))}" class="${(isGroup ? this.selectedGroup : this.selectedCategory) === option.id ? "is-selected" : ""}"><img src="${escapeText(option.icon)}" alt=""><span>${escapeText(option.label)}</span></button>`).join("")}</div></section></div>`;
  }

  private attachEvents(): void {
    this.host.querySelectorAll<HTMLElement>("[data-user-action]").forEach((element) => {
      element.addEventListener("click", (event) => { event.preventDefault(); void this.handleAction(element.dataset.userAction ?? "", element.dataset.id ?? ""); });
    });
    const form = this.host.querySelector<HTMLFormElement>('[data-user-form="place"]');
    form?.addEventListener("submit", (event) => { event.preventDefault(); void this.handleSave(event.currentTarget as HTMLFormElement); });
    form?.addEventListener("input", () => this.captureEditorDraft());
    form?.addEventListener("change", (event) => {
      if (!(event.target instanceof HTMLInputElement) || event.target.type !== "file") this.captureEditorDraft();
    });
    const feedbackForm = this.host.querySelector<HTMLFormElement>("[data-user-feedback-form]");
    feedbackForm?.addEventListener("submit", (event) => { event.preventDefault(); void this.handleFeedbackSave(event.currentTarget as HTMLFormElement); });
    form?.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-limit-counter]").forEach((field) => {
      const update = () => { this.updateFieldCounter(field); this.validateTextField(field, false); };
      field.addEventListener("input", update);
      field.addEventListener("blur", () => this.validateTextField(field, true));
      update();
    });
    form?.querySelectorAll<HTMLInputElement>('[name="longitude"], [name="latitude"]').forEach((field) => {
      field.addEventListener("input", () => this.validateCoordinateField(field, false));
      field.addEventListener("blur", () => this.validateCoordinateField(field, true));
    });
    const photoInput = form?.querySelector<HTMLInputElement>("[data-user-photo-input]");
    photoInput?.addEventListener("click", () => {
      this.captureEditorDraft();
      // Invalidate any delayed repaint left by an earlier picker round-trip.
      this.photoSelectionEpoch += 1;
      this.photoPickerActive = true;
      this.photoPickerScroll = {
        panel: this.host.querySelector<HTMLElement>(".user-contrib__panel")?.scrollTop ?? 0,
        content: this.host.querySelector<HTMLElement>(".user-contrib__content")?.scrollTop ?? 0
      };
      if (this.photoPickerReleaseTimer !== null) window.clearTimeout(this.photoPickerReleaseTimer);
      this.photoPickerReleaseTimer = null;
    });
    photoInput?.addEventListener("cancel", () => this.restoreEditorAfterPhotoPicker(this.photoSelectionEpoch));
    photoInput?.addEventListener("change", (event) => {
      void this.handlePhotoSelection(event.currentTarget as HTMLInputElement);
    });
    this.host.querySelectorAll<HTMLImageElement>("[data-user-avatar]").forEach((image) => {
      const shell = image.closest<HTMLElement>("[data-user-avatar-shell]");
      const loaded = () => shell?.classList.add("is-loaded");
      const failed = () => { shell?.classList.remove("is-loaded"); image.remove(); };
      image.addEventListener("load", loaded, { once: true });
      image.addEventListener("error", failed, { once: true });
      if (image.complete) { if (image.naturalWidth > 0) loaded(); else failed(); }
    });
    const accountAck = this.host.querySelector<HTMLInputElement>("[data-account-delete-ack]");
    accountAck?.addEventListener("change", () => {
      this.accountDeleteAcknowledged = accountAck.checked;
      const confirmButton = this.host.querySelector<HTMLButtonElement>('[data-user-action="confirm-proceed"]');
      if (confirmButton) confirmButton.disabled = this.busy || !this.accountDeleteAcknowledged;
    });
    const search = this.host.querySelector<HTMLInputElement>("[data-user-choice-search]");
    search?.addEventListener("input", () => {
      const term = search.value.trim().toLocaleLowerCase("en-US");
      this.host.querySelectorAll<HTMLElement>(".user-choice__list [data-search]").forEach((item) => { item.hidden = Boolean(term) && !String(item.dataset.search ?? "").includes(term); });
    });
  }

  private async handleAction(action: string, id: string): Promise<void> {
    if (action === "close") { this.captureEditorDraft(); this.host.hidden = true; return; }
    if (action === "dashboard-tab" && (id === "places" || id === "messages" || id === "notifications" || id === "account")) {
      this.activeDashboardTab = id;
      this.editingFeedbackId = null;
      this.message = "";
      this.render();
      return;
    }
    if (action === "feedback-edit" && id) {
      const target = this.feedback.find((item) => item.id === id);
      if (!target || target.status !== "new") {
        this.message = userPrivateCopy(this.options.getLanguage()).messageEditLocked;
        this.messageKind = "error";
        this.render();
        return;
      }
      this.editingFeedbackId = id;
      this.activeDashboardTab = "messages";
      this.render();
      return;
    }
    if (action === "feedback-cancel") {
      this.editingFeedbackId = null;
      this.render();
      return;
    }
    if (action === "feedback-delete" && id) {
      this.pendingConfirmation = { kind: "delete-feedback", feedbackId: id };
      this.render();
      return;
    }
    if (action === "notification-delete" && id) {
      this.pendingConfirmation = { kind: "delete-notification", notificationId: id };
      this.render();
      return;
    }
    if (action === "history-delete" && id && this.identity) {
      this.pendingConfirmation = { kind: "delete-history", historyId: id };
      this.render();
      return;
    }
    if (action === "history-clear" && this.identity && this.navigationHistory.length > 0) {
      this.pendingConfirmation = { kind: "clear-history" };
      this.render();
      return;
    }
    if (action === "google-signin") {
      if (this.busy) return;
      this.busy = true;
      this.message = "";
      this.messageKind = "normal";
      this.render();
      try {
        await signInAtlasWithGoogle();
      } catch (error) {
        this.message = atlasErrorMessage(error);
        this.messageKind = "error";
      } finally {
        this.busy = false;
        this.render();
      }
      return;
    }
    if (action === "signout") {
      if (!this.identity || this.busy) return;
      this.captureEditorDraft();
      this.pendingConfirmation = { kind: "signout" };
      this.render();
      return;
    }
    if (action === "legal-accept") {
      const checkbox = this.host.querySelector<HTMLInputElement>("#atlasLegalAccept");
      if (!checkbox?.checked || !this.identity) { this.message = this.copy().legalRequired; this.messageKind = "error"; this.render(); return; }
      await this.run(async () => { this.profile = await acceptAtlasLegalTerms(this.options.getLanguage(), this.identity!); this.message = ""; }, "dashboard");
      this.resumePendingNewPlace();
      return;
    }
    if (action === "delete-request" && this.identity) {
      this.accountDeleteAcknowledged = false;
      this.pendingConfirmation = { kind: "delete-account" };
      this.render();
      return;
    }
    if (action === "delete-place" && id && this.identity) {
      const place = this.places.find((item) => item.id === id);
      if (!place || place.created_by !== this.identity.userId || place.submission_source !== "user") return;
      this.pendingConfirmation = { kind: "delete-place", placeId: id };
      this.render();
      return;
    }
    if (action === "photo-clear") {
      this.clearPendingPhoto();
      this.render();
      return;
    }
    if (action === "photo-delete" && id && this.identity && this.editing) {
      const place = this.places.find((item) => item.id === this.editing?.id);
      const ownsEditableDraft = place?.created_by === this.identity.userId
        && place.submission_source === "user"
        && place.status === "draft"
        && place.review_status !== "approved";
      if (!place || !ownsEditableDraft || !orderedAtlasPhotos(place).some((photo) => photo.id === id)) return;
      this.pendingConfirmation = { kind: "delete-photo", placeId: place.id, photoId: id };
      this.render();
      return;
    }
    if (action === "confirm-cancel") {
      if (this.busy) return;
      this.pendingConfirmation = null;
      this.accountDeleteAcknowledged = false;
      this.render();
      return;
    }
    if (action === "confirm-proceed" && this.pendingConfirmation && this.identity) {
      const pending = this.pendingConfirmation;
      if (pending.kind === "delete-account" && !this.accountDeleteAcknowledged) return;
      this.pendingConfirmation = null;
      if (pending.kind === "signout") {
        await this.run(async () => {
          await signOutAtlasUser();
          this.identity = null;
          this.profile = null;
          this.places = [];
          this.notifications = [];
          this.feedback = [];
          this.navigationHistory = [];
          this.editorDraft = null;
          this.clearPendingNewPlaceCoordinate();
          this.message = "";
          this.messageKind = "normal";
        }, "signin");
        return;
      }
      if (pending.kind === "delete-account") {
        this.busy = true;
        this.message = "";
        this.messageKind = "normal";
        this.render();
        try {
          const deletedUserId = this.identity?.userId;
          await deleteAtlasAccountAndData(this.identity);
          this.identity = null;
          this.profile = null;
          this.places = [];
          this.notifications = [];
          this.feedback = [];
          this.navigationHistory = [];
          removePendingNavigationHistory(undefined, deletedUserId);
          this.clearEditorDraft();
          this.clearPendingNewPlaceCoordinate();
          this.clearPendingPhoto();
          this.options.onUnreadCountChange?.(0);
          this.accountDeleteAcknowledged = false;
          this.view = "signin";
          this.message = this.copy().deletionRequested;
          this.messageKind = "success";
        } catch (error) {
          this.view = "dashboard";
          this.pendingConfirmation = { kind: "delete-account" };
          this.accountDeleteAcknowledged = false;
          this.message = atlasErrorMessage(error);
          this.messageKind = "error";
        } finally {
          this.busy = false;
          this.render();
        }
        return;
      }
      if (pending.kind === "delete-feedback") {
        this.busy = true;
        this.message = "";
        this.messageKind = "normal";
        this.render();
        try {
          await deleteOwnAtlasFeedback(pending.feedbackId);
          this.feedback = this.feedback.filter((item) => item.id !== pending.feedbackId);
          this.editingFeedbackId = null;
          this.activeDashboardTab = "messages";
          this.message = userPrivateCopy(this.options.getLanguage()).messageDeleted;
          this.messageKind = "success";
        } catch (error) {
          this.message = atlasErrorMessage(error);
          this.messageKind = "error";
        } finally {
          this.busy = false;
          this.view = "dashboard";
          this.render();
        }
        return;
      }
      if (pending.kind === "delete-notification") {
        this.busy = true;
        this.message = "";
        this.messageKind = "normal";
        this.render();
        try {
          await deleteAtlasNotification(pending.notificationId);
          this.notifications = this.notifications.filter((item) => item.id !== pending.notificationId);
          this.options.onUnreadCountChange?.(this.notifications.filter((item) => !item.is_read).length);
          this.activeDashboardTab = "notifications";
          this.message = userPrivateCopy(this.options.getLanguage()).notificationDeleted;
          this.messageKind = "success";
        } catch (error) {
          this.message = atlasErrorMessage(error);
          this.messageKind = "error";
        } finally {
          this.busy = false;
          this.view = "dashboard";
          this.render();
        }
        return;
      }
      if (pending.kind === "delete-history" || pending.kind === "clear-history") {
        this.busy = true;
        this.message = "";
        this.messageKind = "normal";
        this.render();
        try {
          if (pending.kind === "delete-history") {
            await deleteAtlasNavigationHistory(pending.historyId);
            this.navigationHistory = this.navigationHistory.filter((entry) => entry.id !== pending.historyId);
            removePendingNavigationHistory(pending.historyId, this.identity?.userId);
            this.message = navigationHistoryCopy(this.options.getLanguage()).deleted;
          } else {
            await clearAtlasNavigationHistory();
            this.navigationHistory = [];
            removePendingNavigationHistory(undefined, this.identity?.userId);
            this.message = navigationHistoryCopy(this.options.getLanguage()).cleared;
          }
          this.activeDashboardTab = "account";
          this.messageKind = "success";
        } catch (error) {
          this.message = atlasErrorMessage(error);
          this.messageKind = "error";
        } finally {
          this.busy = false;
          this.view = "dashboard";
          this.render();
        }
        return;
      }
      if (pending.kind === "delete-photo") {
        const place = this.places.find((item) => item.id === pending.placeId);
        if (!place || place.created_by !== this.identity.userId || place.submission_source !== "user") return;
        this.busy = true;
        this.message = "";
        this.messageKind = "normal";
        this.render();
        try {
          const result = await deleteManagedAtlasPhoto(place, pending.photoId);
          this.places = await loadUserAtlasPlaces(this.identity);
          const refreshed = this.places.find((item) => item.id === place.id) ?? null;
          this.editing = refreshed ? atlasPlaceWithRevisionPreview(refreshed) : null;
          this.message = result.mediaCleanupWarning ? this.copy().photoCleanupWarning : this.copy().photoDeleted;
          this.messageKind = result.mediaCleanupWarning ? "error" : "success";
          await this.options.onPlacesChanged();
        } catch (error) {
          this.message = atlasErrorMessage(error);
          this.messageKind = "error";
        } finally {
          this.busy = false;
          this.view = this.editing ? "editor" : "dashboard";
          this.render();
        }
        return;
      }
      if (pending.kind !== "delete-place") return;
      this.busy = true;
      this.message = "";
      this.messageKind = "normal";
      this.render();
      try {
        const result = await deleteUserAtlasPlace(pending.placeId, this.identity);
        this.places = await loadUserAtlasPlaces(this.identity);
        this.message = result.mediaCleanupWarning ? this.copy().deletePlaceCleanupWarning : this.copy().deletePlaceSuccess;
        this.messageKind = result.mediaCleanupWarning ? "error" : "success";
        await this.options.onPlacesChanged();
      } catch (error) {
        this.message = atlasErrorMessage(error);
        this.messageKind = "error";
      } finally {
        this.busy = false;
        this.view = "dashboard";
        this.render();
      }
      return;
    }
    if (action === "add") { this.openNewPlace(); return; }
    if (action === "back") { this.captureEditorDraft(); this.editing = null; this.view = "dashboard"; this.render(); return; }
    if (action === "edit" && id) {
      const place = this.places.find((item) => item.id === id);
      if (!place || place.active_revision?.review_status === "pending") return;
      const preview = atlasPlaceWithRevisionPreview(place);
      this.editing = preview;
      this.clearPendingPhoto();
      this.editorDraft = this.loadStoredDraft(place.id);
      this.coordinate = [preview.longitude, preview.latitude];
      this.selectedCategory = (atlasTaxonomyEntry(preview.category)?.id ?? "village") as AtlasCategory;
      this.selectedGroup = atlasPlaceTypeGroup(this.selectedCategory) || ATLAS_TAXONOMY_GROUPS[0].id;
      this.view = "editor";
      this.render();
      return;
    }
    if (action === "withdraw" && id && this.identity) {
      await this.run(async () => { await withdrawUserAtlasSubmission(id, this.identity!); this.places = await loadUserAtlasPlaces(this.identity!); this.message = this.copy().withdrawnMessage; this.messageKind = "success"; }, "dashboard");
      return;
    }
    if (action === "withdraw-approved" && id && this.identity) {
      await this.run(async () => {
        await withdrawUserAtlasApprovedPlace(id, this.identity!);
        this.places = await loadUserAtlasPlaces(this.identity!);
        this.message = this.copy().withdrawnMessage;
        this.messageKind = "success";
        await this.options.onPlacesChanged();
      }, "dashboard");
      return;
    }
    if (action === "withdraw-revision" && id && this.identity) {
      await this.run(async () => { await withdrawUserAtlasRevision(id, this.identity!); this.places = await loadUserAtlasPlaces(this.identity!); this.message = this.copy().withdrawnMessage; this.messageKind = "success"; }, "dashboard");
      return;
    }
    if (action === "notification-read" && id) {
      await this.run(async () => {
        await markAtlasNotificationRead(id);
        this.notifications = this.notifications.map((item) => item.id === id ? { ...item, is_read: true } : item);
        this.options.onUnreadCountChange?.(this.notifications.filter((item) => !item.is_read).length);
      }, "dashboard");
      return;
    }
    if (action === "notifications-read-all") {
      await this.run(async () => {
        await markAllAtlasNotificationsRead();
        this.notifications = this.notifications.map((item) => ({ ...item, is_read: true }));
        this.options.onUnreadCountChange?.(0);
        this.message = this.copy().notificationsMarkedRead;
        this.messageKind = "success";
      }, "dashboard");
      return;
    }
    if (action === "notifications-delete-read") {
      await this.run(async () => {
        await deleteReadAtlasNotifications();
        this.notifications = this.notifications.filter((item) => !item.is_read);
        this.options.onUnreadCountChange?.(this.notifications.length);
        this.message = this.copy().readNotificationsDeleted;
        this.messageKind = "success";
      }, "dashboard");
      return;
    }
    if (action === "pick-map") {
      this.captureEditorDraft();
      this.host.hidden = true;
      this.options.requestMapPoint((coordinate) => {
        this.coordinate = [Number(formatAtlasCoordinate(coordinate[0])), Number(formatAtlasCoordinate(coordinate[1]))];
        if (this.editorDraft) { this.editorDraft.longitude = formatAtlasCoordinate(coordinate[0]); this.editorDraft.latitude = formatAtlasCoordinate(coordinate[1]); }
        this.host.hidden = false;
        this.render();
      });
      return;
    }
    if (action === "choice-group") { this.captureEditorDraft(); this.choice = "group"; this.render(); return; }
    if (action === "choice-type") { this.captureEditorDraft(); this.choice = "type"; this.render(); return; }
    if (action === "choice-close") { this.choice = null; this.render(); return; }
    if (action === "choice-select" && id) {
      if (this.choice === "group") {
        this.selectedGroup = id;
        const first = ATLAS_TAXONOMY.find((entry) => entry.group === id);
        if (first) this.selectedCategory = first.id as AtlasCategory;
      } else if (this.choice === "type") {
        const entry = atlasTaxonomyEntry(id);
        if (entry) { this.selectedCategory = entry.id as AtlasCategory; this.selectedGroup = entry.group; }
      }
      if (this.editorDraft) { this.editorDraft.category = this.selectedCategory; this.editorDraft.category_group = this.selectedGroup; }
      this.choice = null;
      this.render();
    }
  }

  private async handleFeedbackSave(form: HTMLFormElement): Promise<void> {
    const id = form.dataset.id ?? "";
    const target = this.feedback.find((item) => item.id === id);
    if (!target || target.status !== "new") {
      this.message = userPrivateCopy(this.options.getLanguage()).messageEditLocked;
      this.messageKind = "error";
      this.editingFeedbackId = null;
      this.render();
      return;
    }
    const data = new FormData(form);
    const category = String(data.get("category") ?? target.category) as AtlasFeedbackCategory;
    const message = String(data.get("message") ?? "").trim();
    if (message.length < 20 || message.length > 2000) {
      this.message = this.copy().required;
      this.messageKind = "error";
      this.render();
      return;
    }
    await this.run(async () => {
      const updated = await updateOwnAtlasFeedback(id, category, message);
      this.feedback = this.feedback.map((item) => item.id === updated.id ? updated : item);
      this.editingFeedbackId = null;
      this.activeDashboardTab = "messages";
      this.message = userPrivateCopy(this.options.getLanguage()).messageUpdated;
      this.messageKind = "success";
    }, "dashboard");
  }

  private updateFieldCounter(field: HTMLInputElement | HTMLTextAreaElement): void {
    const maxChars = Number(field.dataset.maxChars ?? field.maxLength ?? 0);
    const maxWords = Number(field.dataset.maxWords ?? 0);
    const counter = this.host.querySelector<HTMLElement>(`[data-field-counter-for="${field.id}"]`);
    if (!counter || !maxChars || !maxWords) return;
    counter.textContent = `${field.value.length}/${maxChars} ${this.copy().characters} · ${countAtlasWords(field.value)}/${maxWords} ${this.copy().words}`;
    counter.dataset.state = field.value.length > maxChars || countAtlasWords(field.value) > maxWords ? "error" : "ok";
  }

  private setFieldError(field: HTMLInputElement | HTMLTextAreaElement, message: string): boolean {
    const error = this.host.querySelector<HTMLElement>(`[data-field-error-for="${field.id}"]`);
    const invalid = Boolean(message);
    field.classList.toggle("is-invalid", invalid);
    field.setAttribute("aria-invalid", invalid ? "true" : "false");
    if (error) { error.textContent = message; error.hidden = !invalid; }
    return !invalid;
  }

  private validateTextField(field: HTMLInputElement | HTMLTextAreaElement, showError: boolean): boolean {
    const copy = this.copy();
    const value = field.value.normalize("NFC").trim();
    let message = "";
    if (field.required && !value) message = copy.fieldRequired;
    const maxChars = Number(field.dataset.maxChars ?? field.maxLength ?? 0);
    const maxWords = Number(field.dataset.maxWords ?? 0);
    if (!message && maxChars > 0 && value.length > maxChars) message = copy.characterLimitExceeded;
    if (!message && maxWords > 0 && countAtlasWords(value) > maxWords) message = copy.wordLimitExceeded;
    const script = field.dataset.atlasScript as AtlasScriptPolicy | undefined;
    if (!message && value && script) {
      try {
        if (!atlasTextMatchesScript(value, script)) message = script === "latin" ? copy.wrongLatinScript : copy.wrongArabicScript;
      } catch {
        message = script === "latin" ? copy.wrongLatinScript : copy.wrongArabicScript;
      }
    }
    return this.setFieldError(field, showError ? message : "") && !message;
  }

  private validateCoordinateField(field: HTMLInputElement, showError: boolean): boolean {
    const copy = this.copy();
    const numeric = Number(field.value);
    const min = Number(field.min);
    const max = Number(field.max);
    let message = "";
    if (!field.value.trim() || !Number.isFinite(numeric)) message = copy.coordinateInvalid;
    else if (numeric < min || numeric > max) message = copy.coordinateRange;
    return this.setFieldError(field, showError ? message : "") && !message;
  }

  private validatePhoto(file: File | null, showError: boolean): boolean {
    const input = this.host.querySelector<HTMLInputElement>("#userPlacePhoto");
    if (!input) return true;
    const copy = this.copy();
    let message = "";
    if (file) {
      if (!(ATLAS_MEDIA_POLICY.allowedMimeTypes as readonly string[]).includes(file.type)) message = copy.invalidPhoto;
      else if (file.size <= 0 || file.size > ATLAS_MEDIA_POLICY.maxBytes) message = file.size > ATLAS_MEDIA_POLICY.maxBytes ? copy.photoTooLarge : copy.invalidPhoto;
    }
    return this.setFieldError(input, showError ? message : "") && !message;
  }

  private validateEditorForm(form: HTMLFormElement): boolean {
    const textFields = [...form.querySelectorAll<HTMLInputElement | HTMLTextAreaElement>("[data-limit-counter]")];
    const coordinateFields = [...form.querySelectorAll<HTMLInputElement>('[name="longitude"], [name="latitude"]')];
    const results = [
      ...textFields.map((field) => this.validateTextField(field, true)),
      ...coordinateFields.map((field) => this.validateCoordinateField(field, true)),
      this.validatePhoto(this.pendingPhotoFile, true)
    ];
    const valid = results.every(Boolean);
    if (!valid) {
      const first = form.querySelector<HTMLElement>('.is-invalid');
      first?.scrollIntoView({ behavior: "smooth", block: "center" });
      first?.focus({ preventScroll: true });
    }
    return valid;
  }

  private async handlePhotoSelection(input: HTMLInputElement): Promise<void> {
    const selected = input.files?.[0] ?? null;
    if (!selected) {
      this.restoreEditorAfterPhotoPicker(this.photoSelectionEpoch);
      return;
    }
    this.captureEditorDraft();
    const selectionEpoch = this.photoPickerActive ? this.photoSelectionEpoch : ++this.photoSelectionEpoch;
    if (this.photoPickerReleaseTimer !== null) window.clearTimeout(this.photoPickerReleaseTimer);
    this.photoPickerReleaseTimer = null;
    this.photoPickerActive = true;
    this.photoProcessing = true;
    this.photoCompressionInfo = "";
    this.uploadProgress = null;
    this.uploadStatus = this.copy().photoCompressing;
    input.disabled = true;
    const submit = this.host.querySelector<HTMLButtonElement>(".user-contrib__submit");
    if (submit) submit.disabled = true;
    this.updateUploadProgress(null, this.uploadStatus);
    this.syncPhotoSelectionUi();

    try {
      // Normalization itself can reject for revoked Android content URIs or a
      // document provider that closes the stream early. Keep it inside this
      // recovery boundary so the modal can never remain picker-locked.
      const original = await normalizeAtlasImageFile(selected);
      if (selectionEpoch !== this.photoSelectionEpoch) return;
      if (!this.validatePhoto(original, true)) {
        input.value = "";
        this.pendingPhotoFile = null;
        this.photoCompressionInfo = "";
        if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
        this.photoPreviewUrl = null;
        this.message = original.size > ATLAS_MEDIA_POLICY.maxBytes ? this.copy().photoTooLarge : this.copy().invalidPhoto;
        this.messageKind = "error";
        return;
      }

      this.pendingPhotoFile = original;
      if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
      this.photoPreviewUrl = URL.createObjectURL(original);
      this.syncPhotoSelectionUi();

      const prepared = await prepareAtlasImage(original, (stage) => {
        if (selectionEpoch !== this.photoSelectionEpoch) return;
        this.uploadStatus = stage === "complete" ? this.copy().photoCompressed : this.copy().photoCompressing;
        this.updateUploadProgress(null, this.uploadStatus);
      });
      if (selectionEpoch !== this.photoSelectionEpoch) return;
      this.pendingPhotoFile = prepared.file;
      this.photoCompressionInfo = prepared.compressed
        ? `${formatFileSize(prepared.originalBytes)} → ${formatFileSize(prepared.outputBytes)}`
        : formatFileSize(prepared.outputBytes);
      if (prepared.file !== original) {
        if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
        this.photoPreviewUrl = URL.createObjectURL(prepared.file);
      }
    } catch (error) {
      if (selectionEpoch !== this.photoSelectionEpoch) return;
      this.pendingPhotoFile = null;
      this.photoCompressionInfo = "";
      if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
      this.photoPreviewUrl = null;
      this.message = atlasErrorMessage(error);
      this.messageKind = "error";
    } finally {
      if (selectionEpoch === this.photoSelectionEpoch) {
        this.uploadProgress = null;
        this.uploadStatus = "";
        this.photoProcessing = false;
        this.syncPhotoSelectionUi();
        this.restoreEditorAfterPhotoPicker(selectionEpoch);
      }
    }
  }

  private armPhotoPickerFallbackRestore(): void {
    if (this.photoProcessing) return;
    if (!this.photoPickerActive) {
      if (this.photoPickerScroll) this.restoreEditorAfterPhotoPicker(this.photoSelectionEpoch);
      return;
    }
    if (this.photoPickerReleaseTimer !== null) window.clearTimeout(this.photoPickerReleaseTimer);
    const selectionEpoch = this.photoSelectionEpoch;
    // Delay long enough for Android WebView to deliver a late `change` event.
    // The real change/cancel handlers restore immediately and cancel this timer.
    this.photoPickerReleaseTimer = window.setTimeout(() => {
      this.photoPickerReleaseTimer = null;
      if (selectionEpoch !== this.photoSelectionEpoch || this.photoProcessing) return;
      this.restoreEditorAfterPhotoPicker(selectionEpoch);
    }, 1100);
  }

  private restoreEditorAfterPhotoPicker(selectionEpoch: number): void {
    if (selectionEpoch !== this.photoSelectionEpoch) return;
    // Unlock even if change/cancel precedes visibilitychange. Otherwise a
    // completed selection can leave render permanently picker-locked.
    this.releasePhotoPicker(selectionEpoch);
    if (document.visibilityState === "hidden" || this.photoProcessing
      || this.view !== "editor" || this.host.hidden) return;
    // Keep the actual form and input nodes. Replacing innerHTML after a mobile
    // chooser can invalidate a late change event and restore the wrong scroll
    // layer. Files, drafts, validation and preview are updated in place.
    this.syncPhotoSelectionUi();
    const panel = this.host.querySelector<HTMLElement>(".user-contrib__panel");
    let message = panel?.querySelector<HTMLElement>(".user-contrib__message");
    if (this.message && panel) {
      if (!message) {
        message = document.createElement("p");
        message.className = "user-contrib__message";
        panel.querySelector(".user-contrib__content")?.before(message);
      }
      message.textContent = this.message;
      message.dataset.kind = this.messageKind;
    } else message?.remove();
    const scroll = this.photoPickerScroll;
    this.photoPickerScroll = null;
    if (scroll) restoreClampedScroll(this.host, [
      { selector: ".user-contrib__panel", value: scroll.panel },
      { selector: ".user-contrib__content", value: scroll.content }
    ]);
  }

  private releasePhotoPicker(selectionEpoch?: number): void {
    if (selectionEpoch !== undefined && selectionEpoch !== this.photoSelectionEpoch) return;
    if (this.photoPickerReleaseTimer !== null) window.clearTimeout(this.photoPickerReleaseTimer);
    this.photoPickerReleaseTimer = null;
    this.photoPickerActive = false;
  }

  /** Update the live picker state while decoding/compressing is in progress. */
  private syncPhotoSelectionUi(): void {
    const input = this.host.querySelector<HTMLInputElement>("[data-user-photo-input]");
    const status = this.host.querySelector<HTMLElement>("[data-user-file-status]");
    const preview = this.host.querySelector<HTMLElement>("[data-user-photo-preview]");
    const image = preview?.querySelector<HTMLImageElement>("img");
    const submit = this.host.querySelector<HTMLButtonElement>(".user-contrib__submit");
    const copy = this.copy();

    if (input) input.disabled = this.photoProcessing;
    if (submit) submit.disabled = this.busy || this.photoProcessing;
    if (status) {
      status.replaceChildren();
      const name = document.createElement("span");
      name.textContent = this.pendingPhotoFile?.name ?? copy.noFileChosen;
      status.append(name);
      if (this.pendingPhotoFile) {
        const size = document.createElement("b");
        size.textContent = formatFileSize(this.pendingPhotoFile.size);
        status.append(size);
      }
      if (this.photoCompressionInfo) {
        const detail = document.createElement("small");
        detail.textContent = this.photoCompressionInfo;
        status.append(detail);
      }
    }
    if (preview) preview.hidden = !this.photoPreviewUrl;
    if (image) {
      if (this.photoPreviewUrl) image.src = this.photoPreviewUrl;
      else image.removeAttribute("src");
    }
  }

  private clearPendingPhoto(): void {
    this.photoSelectionEpoch += 1;
    this.pendingPhotoFile = null;
    this.photoCompressionInfo = "";
    this.photoProcessing = false;
    this.releasePhotoPicker();
    this.photoPickerScroll = null;
    this.uploadProgress = null;
    this.uploadStatus = "";
    if (this.photoPreviewUrl) URL.revokeObjectURL(this.photoPreviewUrl);
    this.photoPreviewUrl = null;
  }

  private updateUploadProgress(value: number | null, status: string): void {
    this.uploadProgress = value === null ? null : Math.max(0, Math.min(100, value));
    this.uploadStatus = status;
    const root = this.host.querySelector<HTMLElement>("[data-user-upload-progress]");
    const progress = root?.querySelector<HTMLProgressElement>("progress");
    const label = root?.querySelector<HTMLElement>("[data-user-upload-status]");
    const percent = root?.querySelector<HTMLElement>("[data-user-upload-percent]");
    if (root) root.hidden = false;
    if (progress) {
      if (this.uploadProgress === null) progress.removeAttribute("value");
      else progress.value = this.uploadProgress;
    }
    if (label) label.textContent = status;
    if (percent) percent.textContent = this.uploadProgress === null ? "" : `${Math.round(this.uploadProgress)}%`;
  }

  private async handleSave(form: HTMLFormElement): Promise<void> {
    if (this.identity?.role === "admin") {
      this.view = "admin-blocked";
      this.render();
      return;
    }
    if (!this.identity || !this.profile?.terms_accepted_at || !this.profile?.privacy_accepted_at) {
      this.message = this.copy().legalRequired;
      this.messageKind = "error";
      this.render();
      return;
    }
    if (this.photoProcessing || !this.validateEditorForm(form)) return;

    // Persist the exact editor state before the busy re-render removes form controls.
    // This prevents network/database failures from discarding the user's work.
    this.captureEditorDraft();
    const data = new FormData(form);
    const draftAtSubmit: Record<string, string> = { ...(this.editorDraft ?? {}) };
    const photo = this.pendingPhotoFile;
    const copy = this.copy();
    this.busy = true;
    this.message = "";
    this.messageKind = "normal";
    this.uploadProgress = null;
    this.uploadStatus = copy.savingPlace;
    this.render();

    let saved: AtlasPlace | null = null;
    try {
      this.updateUploadProgress(null, copy.savingPlace);
      saved = await saveUserAtlasSubmission({
        id: String(data.get("id") ?? "") || undefined,
        name_ku: String(data.get("name_ku") ?? ""),
        name_ar: String(data.get("name_ar") ?? ""),
        name_en: String(data.get("name_en") ?? ""),
        category: this.selectedCategory,
        tags: taxonomyTags(this.selectedCategory),
        description_ku: String(data.get("description_ku") ?? ""),
        description_ar: String(data.get("description_ar") ?? ""),
        description_en: String(data.get("description_en") ?? ""),
        longitude: Number(formatAtlasCoordinate(String(data.get("longitude") ?? ""))),
        latitude: Number(formatAtlasCoordinate(String(data.get("latitude") ?? ""))),
        status: "draft"
      }, this.identity);

      // Once a new row exists, pin the editor draft to that row immediately. If a
      // later photo upload fails, retrying updates the same place instead of creating
      // a duplicate submission.
      const persistedDraft = {
        ...draftAtSubmit,
        id: saved.id,
        category: this.selectedCategory,
        category_group: this.selectedGroup,
        longitude: formatAtlasCoordinate(saved.longitude),
        latitude: formatAtlasCoordinate(saved.latitude)
      };
      this.editing = saved;
      this.coordinate = [saved.longitude, saved.latitude];
      this.persistEditorDraft(persistedDraft);

      if (photo?.name) {
        this.updateUploadProgress(0, copy.uploadingPhoto);
        try {
          await uploadUserAtlasPhoto(saved.id, photo, this.identity, {
            caption_ku: String(data.get("caption_ku") ?? ""),
            caption_ar: String(data.get("caption_ar") ?? ""),
            caption_en: String(data.get("caption_en") ?? "")
          }, (percent) => this.updateUploadProgress(percent, copy.uploadingPhoto));
        } catch (photoError) {
          // The place itself is already persisted. Keep the editor, its exact values,
          // and the selected image so the user can retry without a duplicate row.
          try { this.places = await loadUserAtlasPlaces(this.identity); } catch { /* persisted row remains authoritative */ }
          this.message = `${copy.photoUploadFailedSaved} ${atlasErrorMessage(photoError)}`;
          this.messageKind = "error";
          this.view = "editor";
          return;
        }
      }

      this.updateUploadProgress(100, copy.uploadComplete);
      try { this.places = await loadUserAtlasPlaces(this.identity); }
      catch { this.places = [saved, ...this.places.filter((item) => item.id !== saved!.id)]; }
      this.clearEditorDraft();
      this.clearPendingPhoto();
      this.editing = null;
      this.message = copy.saved;
      this.messageKind = "success";
      this.view = "dashboard";
      try { await this.options.onPlacesChanged(); } catch { /* persistence succeeded; map refresh can recover independently */ }
    } catch (error) {
      this.message = atlasErrorMessage(error);
      this.messageKind = "error";
      this.view = "editor";
      if (saved) this.editing = saved;
    } finally {
      this.busy = false;
      this.uploadProgress = null;
      this.uploadStatus = "";
      this.render();
    }
  }

  private async run(task: () => Promise<void>, view: UserStudioView): Promise<void> {
    this.busy = true;
    this.render();
    try { await task(); this.view = view; }
    catch (error) { this.message = atlasErrorMessage(error); this.messageKind = "error"; this.view = view; }
    finally { this.busy = false; this.render(); }
  }
}

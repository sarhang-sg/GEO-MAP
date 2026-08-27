import type { AtlasPlaceStatus } from "./atlas-places";
import { localizedCategory } from "./map-language";

export type StudioLanguage = "ku" | "ar" | "en";
export type StudioCoordinate = [number, number];


export type StudioView = "signin" | "list" | "editor" | "unavailable";
export type PendingConfirmation =
  | { kind: "signout" }
  | { kind: "place"; placeId: string }
  | { kind: "photo"; placeId: string; photoId: string }
  | { kind: "feedback"; feedbackId: string }
  | { kind: "notification"; notificationId: string };

export type StudioCopy = {
  title: string;
  subtitle: string;
  close: string;
  unavailable: string;
  loginTitle: string;
  loginHint: string;
  email: string;
  password: string;
  signIn: string;
  signOut: string;
  signOutConfirmTitle: string;
  signOutConfirmBody: string;
  signOutConfirmAction: string;
  ownerOnly: string;
  checkpoints: string;
  add: string;
  refresh: string;
  empty: string;
  edit: string;
  delete: string;
  deleteConfirm: string;
  deleted: string;
  deleteCleanupWarning: string;
  save: string;
  cancel: string;
  placeOnMap: string;
  mapPickHint: string;
  nameKu: string;
  nameAr: string;
  nameEn: string;
  category: string;
  status: string;
  draft: string;
  published: string;
  hidden: string;
  descriptionKu: string;
  descriptionAr: string;
  descriptionEn: string;
  longitude: string;
  latitude: string;
  saved: string;
  saving: string;
  signedIn: string;
  pickNext: string;
  media: string;
  mediaSaveFirst: string;
  gallery: string;
  noPhotos: string;
  photoFile: string;
  chooseFile: string;
  noFileChosen: string;
  savedCaption: string;
  noSavedCaption: string;
  placeType: string;
  categoryGroup: string;
  tags: string;
  tagsHint: string;
  editorIntroAdd: string;
  editorIntroEdit: string;
  sectionBasics: string;
  sectionDescription: string;
  sectionRelevant: string;
  sectionLocation: string;
  sectionPublishing: string;
  reviewTab: string;
  workTab: string;
  publishedTab: string;
  noReviewPlaces: string;
  noWorkPlaces: string;
  noPublishedPlaces: string;
  optional: string;
  required: string;
  draftProtected: string;
  saveChanges: string;
  saveDraftFirst: string;
  publishingTitle: string;
  publishingIntro: string;
  currentStatus: string;
  publishNow: string;
  moveToDraft: string;
  hidePlace: string;
  publishedSuccess: string;
  draftSuccess: string;
  hiddenSuccess: string;
  approve: string;
  reject: string;
  approvedReviewSuccess: string;
  rejectedReviewSuccess: string;
  choiceSearch: string;
  choiceClose: string;
  restoredDraft: string;
  contentLimitHint: string;
  photoCaptionKu: string;
  photoCaptionAr: string;
  photoCaptionEn: string;
  upload: string;
  uploadHint: string;
  uploaded: string;
  uploadFailed: string;
  photoSave: string;
  photoSaved: string;
  cover: string;
  coverCurrent: string;
  moveEarlier: string;
  moveLater: string;
  removePhoto: string;
  removePhotoConfirm: string;
  confirmTitle: string;
  confirmCancel: string;
  confirmProceed: string;
  photoDeleted: string;
  photoCleanupWarning: string;
  noOwner: string;
};

const STUDIO_COPY: Record<StudioLanguage, StudioCopy> = {
  ku: {
    title: "بەڕێوەبەرایەتی NAV KURD",
    subtitle: "زیادکردن و بەڕێوەبردنی شوێن و چێکپۆینتەکان",
    close: "داخستن",
    unavailable: "خزمەتی بەڕێوەبردنی شوێنەکان ئێستا بەردەست نییە.",
    loginTitle: "چوونەژوورەوەی بەڕێوەبەر",
    loginHint: "بە هەژماری Google ـی تۆمارکراوی بەڕێوەبەر بچۆ ژوورەوە. دەسەڵات لە بنکەدراوە پشتڕاست دەکرێتەوە.",
    email: "ئیمەیڵ",
    password: "وشەی نهێنی",
    signIn: "چوونەژوورەوە بە Google",
    signOut: "چوونەدەرەوە",
    signOutConfirmTitle: "دڵنیایت دەتەوێت لە بەڕێوەبەرایەتی بچیتە دەرەوە؟",
    signOutConfirmBody: "session ـی بەڕێوەبەر لەم ئامێرەدا دادەخرێت. هیچ شوێن، پشکنین یان داتایەک ناسڕێتەوە.",
    signOutConfirmAction: "بەڵێ، بچۆ دەرەوە",
    ownerOnly: "ئەم ئەکاونتە دەستگەیشتنی بەڕێوەبردنی ناوەڕۆک نییە.",
    checkpoints: "چێکپۆینتەکان",
    add: "زیادکردنی شوێن",
    refresh: "نوێکردنەوە",
    empty: "هێشتا هیچ شوێنێک زیاد نەکراوە.",
    edit: "دەستکاری",
    delete: "سڕینەوە",
    deleteConfirm: "دڵنیایت لەم سڕینەوەیە؟ شوێنەکە و هەموو وێنەکانی دەسڕدرێنەوە و ناگەڕێندرێنەوە.",
    deleted: "شوێنەکە سڕایەوە.",
    deleteCleanupWarning: "شوێنەکە سڕایەوە، بەڵام پاککردنەوەی هەندێک فایل لە Storage سەرکەوتوو نەبوو.",
    save: "پاشەکەوتکردن",
    cancel: "گەڕانەوە",
    placeOnMap: "دیاریکردن لەسەر ماپ",
    mapPickHint: "دوای کرتەکردن، لەسەر ماپ شوێنی چێکپۆینتەکە هەڵبژێرە.",
    nameKu: "ناوی کوردی *",
    nameAr: "ناوی عەرەبی",
    nameEn: "English name",
    category: "جۆر",
    status: "دۆخ",
    draft: "ڕەشنووس",
    published: "بڵاوکراوە",
    hidden: "شاراوە",
    descriptionKu: "وەسفی کوردی",
    descriptionAr: "وەسفی عەرەبی",
    descriptionEn: "English description",
    longitude: "درێژی",
    latitude: "پانی",
    saved: "شوێنەکە بە سەرکەوتوویی پاشەکەوت کرا. ئێستا دەتوانیت وێنە زیاد بکەیت.",
    saving: "خەریکی پاشەکەوتکردن…",
    signedIn: "چوویتە ژوورەوە وەک خاوەن.",
    pickNext: "لە ماپدا شوێنێک هەڵبژێرە.",
    media: "وێنە و گەلەری",
    mediaSaveFirst: "سەرەتا شوێنەکە پاشەکەوت بکە، پاشان وێنە زیاد بکە.",
    gallery: "گەلەری",
    noPhotos: "هێشتا هیچ وێنەیەک زیاد نەکراوە.",
    photoFile: "فایلی وێنە",
    chooseFile: "هەڵبژاردنی فایل",
    noFileChosen: "هیچ فایلێک هەڵنەبژێردراوە",
    savedCaption: "کەپشنی پاشەکەوتکراو",
    noSavedCaption: "هێشتا کەپشنێک پاشەکەوت نەکراوە.",
    placeType: "جۆری وردی شوێن",
    categoryGroup: "بەشی سەرەکی",
    tags: "تاگەکان",
    tagsHint: "تاگەکان بە کۆما جیا بکەرەوە؛ نموونە: emergency, public, 24h",
    editorIntroAdd: "شوێنێکی نوێ بە هەنگاوێکی پاک و پڕۆفێشناڵ زیاد بکە. تەنها زانیاری پەیوەندیدار بە جۆری شوێنەکە نیشان دەدرێت.",
    editorIntroEdit: "دەستکارییەکە تەنها بەشە پەیوەندیدارەکانی ئەم شوێنە پیشان دەدات بۆ ئەوەی خێراتر و پاکتر بێت.",
    sectionBasics: "زانیاری سەرەکی",
    sectionDescription: "ناوەڕۆک و وەسف",
    sectionRelevant: "زانیاری پەیوەندیدار بە جۆری شوێن",
    sectionLocation: "شوێن و کۆئۆردینات",
    sectionPublishing: "بڵاوکردنەوە",
    reviewTab: "ڕیڤیو و داواکاری",
    workTab: "ڕەشنووس و دەستکاری",
    publishedTab: "بڵاوکراوەکان",
    noReviewPlaces: "هیچ داواکارییەکی چاوەڕوانی ڕیڤیو نییە.",
    noWorkPlaces: "هیچ ڕەشنووس یان شوێنی شاراوە نییە.",
    noPublishedPlaces: "هێشتا هیچ شوێنێک بڵاونەکراوەتەوە.",
    optional: "ئارەزومەندانە",
    required: "پێویست",
    draftProtected: "زانیارییە نەپاشەکەوتکراوەکان لەم ئامێرەدا خۆکارانە پارێزراون و دوای دەرچوون لە براوسەر ون نابن.",
    saveChanges: "پاشەکەوتی دەستکاری",
    saveDraftFirst: "پاشەکەوت وەک ڕەشنووس",
    publishingTitle: "بەڕێوەبردنی بڵاوکردنەوە",
    publishingIntro: "بڵاوکردنەوە لە دەستکاری ناوەڕۆک جیاکراوەتەوە. سەرەتا زانیاری پاشەکەوت بکە، پاشان دۆخی بڵاوکردنەوە بگۆڕە.",
    currentStatus: "دۆخی ئێستا",
    publishNow: "ئێستا بڵاوی بکەرەوە",
    moveToDraft: "بگەڕێنەوە بۆ ڕەشنووس",
    hidePlace: "شوێنەکە بشارەوە",
    publishedSuccess: "شوێنەکە بڵاوکرایەوە.",
    draftSuccess: "شوێنەکە گەڕایەوە بۆ ڕەشنووس.",
    hiddenSuccess: "شوێنەکە شارایەوە.",
    approve: "پەسەندکردن",
    reject: "ڕەتکردنەوە",
    approvedReviewSuccess: "داواکارییەکە پەسەند کرا و بڵاوکرایەوە.",
    rejectedReviewSuccess: "داواکارییەکە گەڕێندرایەوە بۆ دەستکاری.",
    choiceSearch: "گەڕان لە هەڵبژاردەکان",
    choiceClose: "داخستن",
    restoredDraft: "ڕەشنووسی نەپاشەکەوتکراوی پێشوو گەڕێندرایەوە.",
    contentLimitHint: "سنووری پیت و وشە خۆکارانە جێبەجێ دەکرێت.",
    photoCaptionKu: "کەپشنی کوردی",
    photoCaptionAr: "کەپشنی عەرەبی",
    photoCaptionEn: "English caption",
    upload: "بارکردنی وێنە",
    uploadHint: "تەنها JPEG، PNG یان WebP تا ١٠MB. یەک وێنە لە هەر جارێکدا بۆ کەپشنی دروست بار بکە.",
    uploaded: "وێنەکە بارکرا.",
    uploadFailed: "بارکردنی وێنە سەرکەوتوو نەبوو.",
    photoSave: "پاشەکەوتی کەپشن",
    photoSaved: "کەپشنی وێنە پاشەکەوت کرا.",
    cover: "بکە بە وێنەی سەرەکی",
    coverCurrent: "وێنەی سەرەکی",
    moveEarlier: "بەرەو پێش",
    moveLater: "بەرەو دوا",
    removePhoto: "سڕینەوەی وێنە",
    removePhotoConfirm: "ئایا دڵنیایت ئەم وێنەیە بسڕیتەوە؟ ناگەڕێندرێتەوە.",
    confirmTitle: "دڵنیابوونەوەی سڕینەوە",
    confirmCancel: "پاشگەزبوونەوە",
    confirmProceed: "بەڵێ، بسڕەوە",
    photoDeleted: "وێنەکە سڕایەوە.",
    photoCleanupWarning: "ڕیزبەندی بنکەدراوە سڕایەوە، بەڵام پاککردنەوەی فایلەکە لە Storage سەرکەوتوو نەبوو.",
    noOwner: "ئەم ئەکاونتە دەستگەیشتنی بەڕێوەبردنی شوێنەکان نییە."
  },
  ar: {
    title: "إدارة NAV KURD",
    subtitle: "إضافة وإدارة الأماكن ونقاط التحقق",
    close: "إغلاق",
    unavailable: "خدمة إدارة الأماكن غير متاحة الآن.",
    loginTitle: "تسجيل دخول المشرف",
    loginHint: "سجّل الدخول بحساب Google المسجّل للمشرف. يتم التحقق من الصلاحية في قاعدة البيانات.",
    email: "البريد الإلكتروني",
    password: "كلمة المرور",
    signIn: "المتابعة باستخدام Google",
    signOut: "تسجيل الخروج",
    signOutConfirmTitle: "هل تريد تسجيل الخروج من لوحة الإدارة؟",
    signOutConfirmBody: "ستنتهي جلسة المشرف على هذا الجهاز، ولن يتم حذف أي مكان أو مراجعة أو بيانات.",
    signOutConfirmAction: "نعم، تسجيل الخروج",
    ownerOnly: "هذا الحساب لا يملك صلاحية إدارة المحتوى.",
    checkpoints: "نقاط التحقق",
    add: "إضافة مكان",
    refresh: "تحديث",
    empty: "لم تتم إضافة أماكن بعد.",
    edit: "تعديل",
    delete: "حذف",
    deleteConfirm: "هل أنت متأكد؟ سيتم حذف المكان وجميع صوره ولا يمكن التراجع.",
    deleted: "تم حذف المكان.",
    deleteCleanupWarning: "تم حذف المكان، لكن لم يكتمل تنظيف بعض ملفات التخزين.",
    save: "حفظ",
    cancel: "رجوع",
    placeOnMap: "اختيار من الخريطة",
    mapPickHint: "بعد الضغط اختر موقع نقطة التحقق على الخريطة.",
    nameKu: "الاسم الكردي *",
    nameAr: "الاسم العربي",
    nameEn: "الاسم بالإنجليزية",
    category: "الفئة",
    status: "الحالة",
    draft: "مسودة",
    published: "منشور",
    hidden: "مخفي",
    descriptionKu: "الوصف الكردي",
    descriptionAr: "الوصف العربي",
    descriptionEn: "الوصف بالإنجليزية",
    longitude: "خط الطول",
    latitude: "خط العرض",
    saved: "تم حفظ المكان. يمكنك الآن إضافة الصور.",
    saving: "جارٍ الحفظ…",
    signedIn: "تم تسجيل الدخول كمالك.",
    pickNext: "اختر موقعًا على الخريطة.",
    media: "الصور والمعرض",
    mediaSaveFirst: "احفظ المكان أولاً، ثم أضف الصور.",
    gallery: "المعرض",
    noPhotos: "لم تتم إضافة صور بعد.",
    photoFile: "ملف الصورة",
    chooseFile: "اختيار ملف",
    noFileChosen: "لم يتم اختيار ملف",
    savedCaption: "التعليق المحفوظ",
    noSavedCaption: "لم يتم حفظ تعليق بعد.",
    placeType: "نوع المكان التفصيلي",
    categoryGroup: "الفئة الرئيسية",
    tags: "الوسوم",
    tagsHint: "افصل الوسوم بفواصل؛ مثال: emergency, public, 24h",
    editorIntroAdd: "أضف مكاناً جديداً من خلال محرر نظيف واحترافي يعرض فقط الحقول ذات الصلة بنوع المكان.",
    editorIntroEdit: "يعرض وضع التعديل الحقول المرتبطة بهذا المكان فقط لتكون العملية أسرع وأوضح.",
    sectionBasics: "المعلومات الأساسية",
    sectionDescription: "المحتوى والوصف",
    sectionRelevant: "البيانات المرتبطة بنوع المكان",
    sectionLocation: "الموقع والإحداثيات",
    sectionPublishing: "النشر",
    reviewTab: "طلبات المراجعة",
    workTab: "المسودات والتحرير",
    publishedTab: "الأماكن المنشورة",
    noReviewPlaces: "لا توجد طلبات بانتظار المراجعة.",
    noWorkPlaces: "لا توجد مسودات أو أماكن مخفية.",
    noPublishedPlaces: "لم يتم نشر أي مكان بعد.",
    optional: "اختياري",
    required: "مطلوب",
    draftProtected: "يتم حفظ التعديلات غير المحفوظة محلياً على هذا الجهاز حتى لا تضيع بعد إغلاق المتصفح.",
    saveChanges: "حفظ التعديلات",
    saveDraftFirst: "حفظ كمسودة",
    publishingTitle: "إدارة النشر",
    publishingIntro: "تم فصل النشر عن تحرير المحتوى. احفظ المعلومات أولاً ثم غيّر حالة النشر بشكل مستقل.",
    currentStatus: "الحالة الحالية",
    publishNow: "نشر الآن",
    moveToDraft: "إرجاع إلى المسودة",
    hidePlace: "إخفاء المكان",
    publishedSuccess: "تم نشر المكان.",
    draftSuccess: "أعيد المكان إلى المسودة.",
    hiddenSuccess: "تم إخفاء المكان.",
    approve: "موافقة",
    reject: "رفض",
    approvedReviewSuccess: "تمت الموافقة على الطلب ونشر المكان.",
    rejectedReviewSuccess: "أُعيد الطلب إلى المستخدم للتعديل.",
    choiceSearch: "البحث في الخيارات",
    choiceClose: "إغلاق",
    restoredDraft: "تمت استعادة المسودة المحلية غير المحفوظة.",
    contentLimitHint: "يتم تطبيق حدود الأحرف والكلمات تلقائياً.",
    photoCaptionKu: "تعليق كردي",
    photoCaptionAr: "تعليق عربي",
    photoCaptionEn: "English caption",
    upload: "رفع الصورة",
    uploadHint: "JPEG أو PNG أو WebP فقط، حتى 10MB. ارفع صورة واحدة في كل مرة لإضافة تعليق صحيح.",
    uploaded: "تم رفع الصورة.",
    uploadFailed: "تعذر رفع الصورة.",
    photoSave: "حفظ التعليق",
    photoSaved: "تم حفظ تعليق الصورة.",
    cover: "تعيين كصورة رئيسية",
    coverCurrent: "الصورة الرئيسية",
    moveEarlier: "نقل للأعلى",
    moveLater: "نقل للأسفل",
    removePhoto: "حذف الصورة",
    removePhotoConfirm: "هل تريد حذف هذه الصورة؟ لا يمكن التراجع.",
    confirmTitle: "تأكيد الحذف",
    confirmCancel: "إلغاء",
    confirmProceed: "نعم، احذف",
    photoDeleted: "تم حذف الصورة.",
    photoCleanupWarning: "تم حذف سجل الصورة، لكن لم يكتمل تنظيف الملف في التخزين.",
    noOwner: "هذا الحساب لا يملك صلاحية إدارة الأماكن."
  },
  en: {
    title: "NAV KURD owner studio",
    subtitle: "Add and manage places and checkpoints",
    close: "Close",
    unavailable: "Place management is not available right now.",
    loginTitle: "Administrator sign in",
    loginHint: "Continue with the administrator Google account. Database authorization is verified separately from authentication.",
    email: "Email",
    password: "Password",
    signIn: "Continue with Google",
    signOut: "Sign out",
    signOutConfirmTitle: "Sign out of the owner studio?",
    signOutConfirmBody: "The administrator session on this device will end. No places, reviews, or data will be deleted.",
    signOutConfirmAction: "Yes, sign out",
    ownerOnly: "This account does not have content-management access.",
    checkpoints: "Checkpoints",
    add: "Add place",
    refresh: "Refresh",
    empty: "No places have been added yet.",
    edit: "Edit",
    delete: "Delete",
    deleteConfirm: "Delete this place and every attached photo? This cannot be undone.",
    deleted: "Place deleted.",
    deleteCleanupWarning: "The place was deleted, but some storage files could not be cleaned up.",
    save: "Save checkpoint",
    cancel: "Back",
    placeOnMap: "Pick on map",
    mapPickHint: "After pressing this, choose the checkpoint location on the map.",
    nameKu: "Kurdish name *",
    nameAr: "Arabic name",
    nameEn: "English name",
    category: "Category",
    status: "Status",
    draft: "Draft",
    published: "Published",
    hidden: "Hidden",
    descriptionKu: "Kurdish description",
    descriptionAr: "Arabic description",
    descriptionEn: "English description",
    longitude: "Longitude",
    latitude: "Latitude",
    saved: "Checkpoint saved. You can now add photos.",
    saving: "Saving…",
    signedIn: "Signed in as owner.",
    pickNext: "Choose a location on the map.",
    media: "Photos and gallery",
    mediaSaveFirst: "Save the checkpoint first, then add photos.",
    gallery: "Gallery",
    noPhotos: "No photos have been added yet.",
    photoFile: "Image file",
    chooseFile: "Choose file",
    noFileChosen: "No file chosen",
    savedCaption: "Saved caption",
    noSavedCaption: "No caption has been saved yet.",
    placeType: "Detailed place type",
    categoryGroup: "Main group",
    tags: "Tags",
    tagsHint: "Separate tags with commas; example: emergency, public, 24h",
    editorIntroAdd: "Add a new place with a clean professional flow that shows only fields relevant to the selected type.",
    editorIntroEdit: "Edit mode shows only settings relevant to this place, keeping the workflow focused and fast.",
    sectionBasics: "Core information",
    sectionDescription: "Content and description",
    sectionRelevant: "Type-specific information",
    sectionLocation: "Location and coordinates",
    sectionPublishing: "Publishing",
    reviewTab: "Review queue",
    workTab: "Drafts & editing",
    publishedTab: "Published places",
    noReviewPlaces: "There are no submissions waiting for review.",
    noWorkPlaces: "There are no drafts or hidden places.",
    noPublishedPlaces: "No places have been published yet.",
    optional: "Optional",
    required: "Required",
    draftProtected: "Unsaved editor changes are stored locally on this device so they survive a browser restart.",
    saveChanges: "Save changes",
    saveDraftFirst: "Save as draft",
    publishingTitle: "Publishing control",
    publishingIntro: "Publishing is separated from content editing. Save the content first, then change publication status independently.",
    currentStatus: "Current status",
    publishNow: "Publish now",
    moveToDraft: "Move to draft",
    hidePlace: "Hide place",
    publishedSuccess: "Place published.",
    draftSuccess: "Place moved to draft.",
    hiddenSuccess: "Place hidden.",
    approve: "Approve",
    reject: "Reject",
    approvedReviewSuccess: "Submission approved and published.",
    rejectedReviewSuccess: "Submission returned to the user for changes.",
    choiceSearch: "Search options",
    choiceClose: "Close",
    restoredDraft: "The previous unsaved local draft was restored.",
    contentLimitHint: "Character and word limits are enforced automatically.",
    photoCaptionKu: "Kurdish caption",
    photoCaptionAr: "Arabic caption",
    photoCaptionEn: "English caption",
    upload: "Upload image",
    uploadHint: "JPEG, PNG or WebP only, up to 10MB. Upload one image at a time so it has the correct caption.",
    uploaded: "Image uploaded.",
    uploadFailed: "The image could not be uploaded.",
    photoSave: "Save caption",
    photoSaved: "Photo caption saved.",
    cover: "Set as cover",
    coverCurrent: "Cover image",
    moveEarlier: "Move earlier",
    moveLater: "Move later",
    removePhoto: "Delete photo",
    removePhotoConfirm: "Delete this image? This cannot be undone.",
    confirmTitle: "Confirm deletion",
    confirmCancel: "Cancel",
    confirmProceed: "Yes, delete",
    photoDeleted: "Image deleted.",
    photoCleanupWarning: "The image record was deleted, but the storage file could not be cleaned up.",
    noOwner: "For access, this account must be registered in `atlas_owners`."
  }
};

export function escapeText(value: string): string {
  return value.replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#039;", '"': "&quot;" })[character] ?? character);
}

export function languageDirection(language: StudioLanguage): "rtl" | "ltr" {
  return language === "en" ? "ltr" : "rtl";
}

export function statusLabel(status: AtlasPlaceStatus, copy: StudioCopy): string {
  return status === "published" ? copy.published : status === "hidden" ? copy.hidden : copy.draft;
}

export function categoryLabel(category: string, language: StudioLanguage): string {
  return localizedCategory(category, language, category.replace(/_/g, " "));
}

export function createBlankCoordinate(): StudioCoordinate {
  return [44.0089, 36.1911];
}


export function getStudioCopy(language: StudioLanguage): StudioCopy {
  return STUDIO_COPY[language];
}

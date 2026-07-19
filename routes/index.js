 const express = require("express"); 
const path = require('path');

const { GetSingleStudent, GetSingleStudentByCode,GetStudents, GetStudentsByClass, RegisterStudent, StudentDelete,
   StudentEnrollmentConfirmationUpdate, StudentUpdate, StudentUpdateClass, StudentUpdateEnrollment, uploadStudentPicture,
    tpath, GetSingleStudentByIdentityCard, GetEmails, GetStudentsByInstitute, GetSTDS,
    GetTransportPassengersByClass,
    DuplicateStudent,
    StudentBulkUpdate,
    StudentClassUpdate,
    StudentDropoutUpdate,
    StudentTransferUpdate,
    GetStudentTransferStatus,
    GetStudentTransferHistory,
    GetTransferredStudents,
    GetStudentOldClasses} = require("../Controllers/Students");
const { CheckExistentEmail, getSingleUserData, GetUserAccounAccess, getUsers, Login, RegisterUserAccounAccess,
   RegisterUserAccount, uploadUserAccountPicture, UserAccountDelete, UpdateUserAccount, getSingleUserImageData,
    CheckUserAccountVerificationCode, UserPasswordReset, UpdateUserPassword, getCurrentUserInformation, UPDATEProfilePicture,
     uploadUserAccountBackgroundPicture, UPDATEProfileCoverImage, SearchUsers, ChangeCurrentUserPassword,
     UpdateUserAccountWhileLoggedin,
     ResetUserPasswordWhileLoggedin,   GoogleAuth} = require("../Controllers/Users");
const VerifyToken  = require("../middleware/VerifyToken");
const { ClassDelete, ClassUpdate, GetClass, GetSingleClass, RegisterClass, GetClassInformation, GetClassOfExams, UpdateAllClassesTransport } = require("../Controllers/Class");
const { CourseDelete, CourseUpdate, GetCourse, GetsingleCourse, RegisterCourse } = require("../Controllers/Courses");
const { AcademicyearDelete, AcademicyearUpdate, GetAcademicYear, GetSingleAcademicYear, RegisterAcademicYear } = require("../Controllers/AcademicYear");
const { ClassRoomDelete, ClassRoomUpdate, GetClassroom, GetSingleClassroom, RegisterClassRoom } = require("../Controllers/ClassRoom");
const { CicleDelete, CicleUpdate, GetCicles, GetSingleCicle, RegisterCicle } = require("../Controllers/Cicles");
const { GetSingleSubject, GetSubjects, RegisterSubject, SubjectDelete, SubjectUpdate, GetClassSubjectsByClassID, AddSubjectToClass, RemoveSubjectFromClass, GetClassSubjectsFromClassTableByClassID, RegisterTeacherSubjectBulk, GetSubjectsByClass2, ToggleKeySubject, UpdateSubjectAverage, UpdateSubjectBehavior } = require("../Controllers/Subjects");
const { GetServices, GetSingleService, RegisterService, ServiceDelete, ServiceUpdate, ServiceUpdateDiscountData } = require("../Controllers/Services");



const { GetServicePayments, GetSingleServicePayment, RegisterServicePayment, 
ServicePaymentDelete, ServicePaymentUpdate, GetStudentServicePayments, 
DeleteServiceWithFees, GenerateReceiptWithFees } = require("../Controllers/ServicePayments");



const { AcademicLevelDelete, AcademicLevelUpdate, GetAcademicLevel, GetSingleAcademicLevel, RegisterAcademicLevel, GetStudentsByAcademicLevel } = require("../Controllers/AcademicLevel");
const { GetProviders, GetSingleProvider, ProviderDelete, ProviderUpdate, RegisterProvider } = require("../Controllers/Provider");
const { FeePaymentDelete, GetFeepayments, GetSinglePaidMonth, GetSinglePayment, GetSingleStudentFees, RegisterFeepayment, FeePaymentUpdate, GetAllClassesPaymentsStatus, GetClassPaymentsStatusById, GetSingleStudentPaymentStatus, GetSingleStudentPaymentStatusByRFID, CheckBordereauStatus, GetBordereauDetail, SetBordereauOriginalValue, ImportSinglePayment, ImportBatchPayments } = require("../Controllers/FeesPayments");
const { CoinDelete, CoinUpdate, GetCoins, RegisterCoin, GetSingleCoin } = require("../Controllers/Coins");
const { GetProducts, GetSingleProduct, ProductDelete, ProductUpdate, RegisterProducts, uploadProductPicture } = require("../Controllers/Products");
const { EmployeeDelete, EmployeeUpdate, Getemployees, GetSingleEmployee, RegisterEmployee, uploadEmployeePicture, GetEmployeeByJobTitle, GetEmployeeDataByUser } = require("../Controllers/Employees");
const { GetSpecificFiles, RegisterFile, uploadFiles, FileDelete } = require("../Controllers/FilesStorage");
const { RegisterRequest, GetRequests, RequestUpdate, RequestDelete, GetsingleRequest } = require("../Controllers/Requests");
const { GetSingleStudentTransference, GetStudentTransferences, RegisterStudentTransference, StudentTransferenceDelete, StudentTransferenceUpdate } = require("../Controllers/StudentTransference");
const { GetTransportPassengers, GetTransportsinglePassenger, RegisterTransportPassenger, TransportPassengerDelete, TransportPassengerUpdate, GetTransportsinglePassengerByStudentId } = require("../Controllers/TransportPassengers");
const { GetsingleTransportRoute, GetTransportRoutes, RegisterTransportRoute, TransportRouteDelete, TransportRouteUpdate } = require("../Controllers/TransportRoutes");
const { GetsingleTransportStop, GetTransportStops, RegisterTransportStop, TransportStopDelete, TransportStopUpdate } = require("../Controllers/TransportStops");
const { GetSingleTransportVehicle, GetTransportVehicles, RegisterTransportVehicle, TransportVehicleDelete, TransportVehicleUpdate, uploadTransportVehiclePicture } = require("../Controllers/TransportVehicles");
const { GetsingleTransportMaintenance, GetTransportMaintenances, RegisterTransportMaintenance, TransportMaintenanceDelete, TransportMaintenanceUpdate } = require("../Controllers/TransportMaintenence");
const { GetSingleTransportDriver, GetTransportDrivers, RegisterTransportDriver, TransportDriverDelete, TransportDriverUpdate, uploadTransportDriverPicture } = require("../Controllers/TransportDriver");
const { GetSingleTitleAndHeader, GetTitleAndHeaders, RegisterTitleAndHeader, TitleAndHeaderDelete, TitleAndHeaderUpdate } = require("../Controllers/TitlesAndHeaders");
const { Getparents, GetSingleparent, ParentDelete, ParentUpdate, RegisterParent, uploadParentPicture, RegisterParentKid, GetParentKids, GetKidsParents, ParentkidDelete } = require("../Controllers/Parents");
const { AuthorDelete, AuthorUpdate, GetAuthors, GetSingleAuthor, RegisterAuthor } = require("../Controllers/Authors");
const { GetPublishers, RegisterPublisher , GetSinglePublisher, PublisherDelete,  PublisherUpdate} = require("../Controllers/Publishers");
const { GetSingleTypeofbook, GetTypeofbooks, RegisterTypeofbook, TypeofbookDelete, TypeofbookUpdate } = require("../Controllers/TypeOfBooks");
const { BookCategoryDelete, BookCategoryUpdate, GetBookCategories, GetSingleBookCategory, RegisterBookCategory } = require("../Controllers/BooksCategory");
const { GetRacks, GetSingleRack, RackDelete, RackUpdate, RegisterRack } = require("../Controllers/Racks");
const { BookDelete, BookUpdate, GetBooks, GetSingleBook, Registerbook, uploadBookCover, RegisterBook } = require("../Controllers/Books");
const { BorrowedBookDelete, BorrowedBookUpdate, GetBorrowedBooks, GetSingleBorrowedBook, RegisterBorrowedbook, RegisterBorrowedBook } = require("../Controllers/BorrowedBooks");
const { GetSingleTiming, GetTimings, RegisterTiming, TimingDelete, TimingUpdate, RegisterTeacherTimingBulk } = require("../Controllers/Timing");
const { GetSchoolsOfProvenance, GetSingleSchoolsOfProvenance, RegisterSchoolsOfProvenance, SchoolsOfProvenanceDelete, SchoolsOfProvenanceUpdate } = require("../Controllers/SchoolsOfProvenance");
const { DeclarationDelete, DeclarationUpdate, GetDeclarations, GetSingleDeclaration, RegisterDeclaration } = require("../Controllers/Declaration"); 
const { GetStudentEnrollments , GetSingleStudentEnrollment, CheckExistentStudentEnrollment, RegisterStudentEnrollment, StudentEnrollmentDelete, StudentEnrollmentUpdate } = require('../Controllers/StudentEnrollment');
const { DeclarationRequestDelete, DeclarationRequestUpdate, GetDeclarationRequests, GetSingleDeclarationRequest, RegisterDeclarationRequest } = require("../Controllers/DeclarationRequests");
const { EnrollOperationDelete, EnrollOperationUpdate, GetEnrollOperations, GetSingleEnrollOperation, RegisterEnrollOperation } = require("../Controllers/EnrollOperations");
const { GetSinglePaidTransportTuitionMonth, GetSingleTransportTuitionpayment, GetTransportTuitionpayments, RegisterTransportTuitionPayment, TransportTuitionPaymentDelete, TransportTuitionPaymentUpadate } = require("../Controllers/TransportTuitions");
const { FeedBackDelete, FeedbackUpdate, GetFeedBacks, GetSingleFeedback, GetSingleUserFeedback, RegisterFeedBack } = require("../Controllers/FeedBacks");
const { GetQuarterlyNotes, GetsingleQuarterlyNote, GetsingleQuarterlyNotebYQrtSub, GetsingleQuarterlyNotebYSubCls, GetsingleQuarterlyNotebYSubStdQrtType, QuarterlyNoteUpdate, RegisterQuarterlyNote, QuarterlyNoteDelete, GetsingleQuarterlyNotebYSubStdQrtTypeClass, GetsingleQuarterlyNoteByID, GetsingleClassScoreByNumber, GetSingleQuarterlyNoteBySubStdQrtType, GetSingleQuarterlyNoteBySubStdQrtTypeClass, GetSingleClassScoreByNumber, GetQuarterlyNotesFullData, GetQuarterlyMiniPautaFullData, GetStudentMTAll3Quarters, GetFinalMiniPautaFullData, GetFinalMiniPautaExamsAndResourceFullData, GetMiniPautaClasseExameBySubject, ListQuarterlyNotes } = require("../Controllers/QuarterlyNotes");
const { GetSingleInstitute, InstituteUpdate, uploadInstituteLogo, GetSingleInstituteByCode, GetCurrentInstituteByCode, GetCurentLicence, GetInstitutes, EduallSearchInstitutes, RegisterInstitute, GetAllRegisteredInstitutes } = require("../Controllers/Institutes");
const { FineDelete, FineUpdate, GetFines, GetSingleFine, GetSingleFineByService, RegisterFine } = require("../Controllers/Fines");
const RefreshToken = require("../Controllers/RefreshToken");
const { GetJobTitles, GetSingleJobTitle } = require("../Controllers/JobTitles");
const { GetSingleTeacherSubject, GetTeacherSubjects, RegisterTeacherSubject, TeacherSubjectDelete, GetSingleTeacherSubjectById, GetTeacherSubjectsData, UpdateTeacherSubject } = require("../Controllers/TeacherSubject");
const { GetStudentAttendance, GetStudentAttendanceByTeacher, GetStudentAttendanceByTeacherAndClassSub, GetSingleStudentAttendance, GetAllStudentAttendance, RegisterStudentAttendance, StudentAttendanceDelete, StudentAttendanceUpdate, CheckExistentSingleStudentAttendance, GetStudentAttendanceByClassSubStuQrt } = require("../Controllers/StudentAttendance");
const { GetSingleTeachertiming, GetAllTeacherTiming, GetSingleTeacherTiming, GetTeacherTimingByClassSub, RegisterTeacherTiming, TeacherTimingDelete, GetAllClassTimings, GetTeacherTimingsData, UpdateTeacherTiming, RegisterTeacherAssignmentsBulk } = require("../Controllers/TeacherTimings");
const { RegisterPoint, GetPointsBySubClass, GetSinglePoint, PointUpdate, PointDelete } = require("../Controllers/ContinuousAvaliation");
const { GetProjectsByCreator, GetSingleTaskAndProject, GetAllTasksAndProjects, TaskAndProjectDelete, RegisterTaskAndProject } = require("../Controllers/TasksAndProjects");
const { RegisterTaskAndProjectMember, TaskAndProjectMemberDelete, GetMembersByProject } = require("../Controllers/TasksAndProjectsMembers");
const { RegisterLessonSection, GetSingleLessonSection, GetLessonsSectionByGroup, LessonSectionDelete, LessonSectionUpdate, LessonSectionUpdatePosition, GetLessonsSectionBuyGroupCode, GetLessonsSectionByCreator, GetSingerAlbums } = require("../Controllers/LessonsSection");
const { ReorderLessonContent, RegisterLessonContent, UpdateLessonContent, DeleteLessonContent, MoveLessonContent, UploadLessonVideo, UploadLessonVideoPoster, GetFullLessonTree, MarkLessonContentDone, RegisterLessonFiles, GetLessonContentById } = require("../Controllers/LessonsSectionContent");
const { RegisterEmployeeAttendance, GetEmployeesAttendance, GetEmployeeAttendanceBycode, EmployeeAttendanceDelete, EmployeeAttendanceUpdate, GetSingleEmployeeAttendance } = require("../Controllers/EmployeeAttendence");
const { GetSingleStudentOldClasses, RegisterOldClass } = require("../Controllers/StudentOldClasses");
const { GetsingleStudentExamNotebYSubStCls, RegisterStudentExamNotes, UpdateStudentExamNotes, DeleteStudentExamNotes, GetAllStudentFeaturedNotesByClassSubject, BulkUpsertStudentFeaturedNotes } = require("../Controllers/StudentExams");
const { GetsingleStudentFeaturedNotebYSubStCls, RegisterStudentFeaturedNotes, UpdateStudentFeaturedNotes, DeleteStudentFeaturedNotes } = require("../Controllers/StudentFeaturedNotes");
const { GetSingleUserInstitutes, GetInstituteAccounts, RegisterInstituteAccount, DeleteInstituteAccount, UpdateInstituteAccount, GetSingleInstituteAccount, UnifiedAccountRegister, GetAppAccounts, GetDashboardAccounts, DeleteAppAccount, UpdateDashboardAccess, GetAvailableApps, GetInstituteApps, RegisterInstituteApp, DeleteInstituteApp, UpdateLibraryPermissions, GetLibraryAccounts, DeleteLibraryAccess, UpdateLibraryAccess } = require("../Controllers/UserInstitutes"); 
const { GetSingleUserChilds, ChewckSingleUserChilds, RegisterUserChilds, GetParentsUserChildsByInstitute, GetUserChilds, UserChildDelete } = require("../Controllers/ParentsChilds");
const { RegisteraDS, addAlbum } = require("../Controllers/Ads");
const { RegisterStudentExamCalendar, GetExamsCalendar, GetExamsCalendarByClass, UpdateStudentExamCalendar, DeleteStudentExamCalendar, GetSingleExamCalendar } = require("../Controllers/StudentExamsCalendar");
const { RegisterEnrollment, GetEnrolledStudents, EnrolledStudentDelete, GetSingleEnrolledStudent, GetSingleEnrolledStudentByCode, EnrolledStudentUpdate } = require("../Controllers/Enrollments");
const { RegisterInstituteUserAccount, GetInstituteUserAccounts, GetSingleInstituteUserAccount, DeleteUserInstituteAccount, UpdateInstituteUserAccount } = require("../Controllers/InstituteAccounts");
const SendEmailMessage = require("../Controllers/SendEmailMessage");
const { RegisterPublication, GetPostsForCurrentUser, GetCurrentUserPosts, GetUserPostsByContacts } = require("../Controllers/Posts");
const { UpdateCurrentUserInstitute, GetCurrentUserData, UpdateNetworkMode, GetCurrentNetworkMode } = require("../Controllers/GetCurrentUserData");
const { RegisterStudentUserAccount, GetSingleUserStudentAccounts, GetUsersStudentsAccountsByInstitute, GetSingleUserStudentAccountsByStudent, UserStudentAccountDelete, GetSingleUserStudentAccountsByStudentWorkspaces, RegisterBulkStudentUserAccounts, ResetStudentPasswordController } = require("../Controllers/UserStudentAccounts");
const ChangeServerNetworkStatus = require("../config/ChangeServerNetworkStatus");
const { RegisterTransportPayments, GetTransportPayments, GetSingleTransportPayment, GetSingleTransportPaidMonth, GetSingleStudentTransportPayments, TransportPaymentsDelete, TransportPaymentsUpdate, GetSingleStudentTransportPaymentsByCode, GetAllClassesTransportPaymentsStatus, GetClassTransportPaymentsStatus, GetSingleStudentTransportPaymentsByRFID } = require("../Controllers/TransportPayments");
const { GetCurrentUserConnections } = require("../Controllers/UserConnections");
const { CreateChatMessage, GetChatMessagesByContact } = require("../Controllers/ChatMessages");
const { RegisterStudentBehavior, GetAllStudentBehaviorByStudentCode } = require("../Controllers/StudentBehavior");
const { FollowInstitute, CheckIfFollowingInstitute, GetSingleInstituteFollowers } = require("../Controllers/InstituteFollowers");
const { MakeUserContactRequest, CheckUserContactRequest } = require("../Controllers/UserContacts");
const { RegisterProfilePageVisitor } = require("../Controllers/ProfilePageViews");
const CalculateRemainingDays = require("../config/CalculateRemainingDays");
const { DATABASE } = require("../config/Database");
const router = express.Router();
 const jwt   = require("jsonwebtoken");     
const { GetLessonsReviewsByLesson } = require("../Controllers/LessonReviews");
const { GetLessonsCommentsByLesson } = require("../Controllers/LessonContentComments");
const { GeCommentsByContentIdAndType, GeCommentsRepliesByCommentId, GeCommentsSubRepliesByReplietId, GeCommentReactionsByReplietIdAndType } = require("../Controllers/Comments");
const { RegisterContact, GetContacts, ContactDelete, ContactUpdate, GetSingleContact, uploadContactPicture } = require("../Controllers/Contacts");
const { GetContactMessagesByContact } = require("../Controllers/ContactMessages");
const { GetSingleCpPage , GetSingleCpPageByCode} = require("../Controllers/Pages");
const { GetSingleFaculty, GetFaculties, RegisterFaculty, FacultyDelete, FacultyUpdate } = require("../Controllers/Faculties");
const { GetsingleSemesterNotebYQrtSub, GetsingleStudentSemesterNotebYCls,
   RegisterSemesterNote, GetsingleSemesterNotebYSubStdQrtTypeClass, SemesterNoteUpdate,
    GetsingleSemesterNoteByID, SemesterNoteDelete, 
    GetSingleSemesterNotebYSubStdQrtTypeClass,
    GetAllSubjectsNotesByStudent,
    GetAllNotesByTrimester,
    GetsingleSemesterNote,
    ListSemesterNotes} = require("../Controllers/SemesterNotes");
const { GetSingleEnrolledConfirmation, EnrollmentConfirmationUpdate, RegisterEnrollmentConfirmation, GetEnrollmentConfirmations, EnrollmentConfirmationDelete, GetSingleEnrolledConfirmationByCode } = require("../Controllers/EnrollmentConfirmation");
const { CalendarEventDelete, GetCalendarEvents, RegisterCalendarEvent, GetSingleCalendarEvent, CalendarEventUpdate } = require("../Controllers/CalendarEvents");
const { GetStatesByCountry } = require("../Controllers/CountriesAndStates");
const { GetAccountsPayableAndReceivable, GetSingleAccountPayableAndReceivable, RegisterAccountPayableAndReceivable, DeleteAccountPayableAndReceivable, UpdateAccountPayableAndReceivable } = require("../Controllers/Accounts_payable_and_receivable");
const { DeleteProductCategory, GetProductCategories, UpdateProductCategory, GetSingleProductCategory, RegisterProductCategory } = require("../Controllers/ProductCategory");
const { GetAdmissionStudents, RegisterAdmissionStudent, GetSingleAdmissionStudent,  DeleteAdmissionStudent, UpdateAdmissionStudent, GetAdmissionExams, RegisterAdmissionExam, 
  GetSingleAdmissionExam, DeleteAdmissionExam, UpdateAdmissionExam, RegisterAdmissionExamSubject,  GetAdmissionExafGetAllClassesPaymentsStatusmSubjects, GetAdmissionExamSubjectsByExam, DeleteAdmissionExamSubject, 
  GetAdmissionResults, RegisterAdmissionResult, GetSingleAdmissionResult, DeleteAdmissionResult,
  GetAdmissionExamSubjects} = require("../Controllers/Admission");  
const { SendSms, GetAllSentSmS, GetCreditsmsInformations, ResendSms } = require("../Controllers/SendSms");
const { SendEmailToContacts, GetAllSentEmails } = require("../Controllers/SendEmail");
const { DeleteSale, GetSingleSale, RegisterSale, GetProductSales } = require("../Controllers/ProductSalles");
const InvoiceController = require("../Functions/CreateInvoiceCode");
const { generateSAFT } = require("../Functions/CreateSaftFiles");
const { GetBookCollections, RegisterBookCollection, GetSingleBookCollection, BookCollectionDelete, BookCollectionUpdate } = require("../Controllers/BooksCollection");
const { GetAllAuditActionsByInstitute } = require("../Controllers/Auditory");
const { VENUDS_GetInvoicePdf, VENDUS_CreateInvoiceCodeAndDoc, VENDUS_GetSAFTFile, handleSaveConfig, handleGetConfig, handleSavePaymentMethod, handleGetPaymentMethods, handleDeletePaymentMethod, handleCreateInvoice } = require("../Functions/VENDUS");
const { GeminiIA, GetIAConversations } = require("../Controllers/0IA");
const { UpdateQuarterlyNoteRestriction, GetQuarterlyNotesPermissions } = require("../Controllers/NotesRestrictions");
const { cacheMiddleware } = require("../middleware/CacheMiddleware"); 
const UploadMiddleware = require("../middleware/UploadMiddleware");
const { RegisterFeedback, DeleteFeedback, GetFeedbacks } = require("../Controllers/DebugFeedback");
const ERP = require('../Controllers/ERP_export');
const { GetLessons_ED, GetSingleLesson_ED, RegisterLesson_ED, LessonUpdate_ED, LessonDelete_ED } = require("../Controllers/EduallLessons");
const { GetOldPayments, GetSingleOldPayment, RegisterOldPayment, DeleteOldPayment, UpdateOldPayment } = require("../Controllers/OldPayments");
const { GetNewsVideos, RegisterNewsVideo, MarkNewsAsSeen, GetLatestUnseenNews } = require("../Controllers/EduallLatestNews");
const {
  AutoDBSetup,
  RFIDRead,
  AssignStudentRFID,
  AssignEmployeeRFID,
  GenerateRFIDCode,
  RegisterRFIDLog,
  GetRFIDLogs,
  CreateSuspension,
  UpdateSuspension,
  LiftSuspension,
  DeleteSuspension,
  CheckSuspension,
  ListSuspensionsByStudent,
  GetAllSuspensions,
  RFIDFullInfo,
} = require("../Controllers/GeneralAttendance");
const {
  GetDigitalContents, GetSingleDigitalContent, RegisterDigitalContent,
  DigitalContentDelete, DigitalContentUpdate, uploadDigitalContentFile,
} = require("../Controllers/BooksDigitalContent");
const {
  GetScientificPublications,
  GetSingleScientificPublication,
  RegisterScientificPublication,
  ScientificPublicationDelete,
  ScientificPublicationUpdate,
  uploadScientificPublicationFile,
} = require('../Controllers/ScientificPublications');
const {
 GetRFIDMovements, GetRFIDMovementsKpis, GetMovementsByExemplar,
   GetAntennas, GetActiveAnomalies, RegisterRFIDEvent, RegisterRFIDBatch,
 ResolveAnomaly, RegisterAntenna, UpdateAntenna, DeleteAntenna,
 DeleteRFIDMovement,
 } = require("../Controllers/RFIDMovements"); 

const { GetExemplares,GetExemplaresByBook,GetSingleExemplar,
  GetExemplarByScan,RegisterExemplar, UpdateExemplar, AssignRFID,
  DeleteExemplar, RegenerateQR, GenerateRFID} = require("../Controllers/BookCopies");

     const {
     GetAllQualificationsStatements,
     GetQualificationsStatementById,
     RegisterQualificationsStatement,
     UpdateQualificationsStatement,
     DeleteQualificationsStatement,
   } = require("../Controllers/SavedDeclarations");


const {
  GetAllCertificates,
  GetCertificateById,
  RegisterCertificate,
  UpdateCertificate,
  DeleteCertificate,
} = require("../Controllers/SavedCertificates");

const {
  GetAllTransferGuides,
  GetTransferGuideById,
  RegisterTransferGuide,
  UpdateTransferGuide,
  DeleteTransferGuide,
} = require("../Controllers/SavedTransferGuide");

const {
  SetAcademicYearTermDates,
  GetAcademicYearTermDates,
  GetPerformanceMap,
  SavePerformanceMap,
  GetSavedPerformanceMaps,
  GetSingleSavedPerformanceMap,
  DeleteSavedPerformanceMap,
} = require("../Controllers/SavedMaps");

 const {
    GetFolderTree, GetRootContents, GetFolderContents,
    CreateFolder, UploadFiles, RenameItem, DeleteItems,
    PasteItem, DownloadFile, GetStats, uploadFileManagerFiles
  } = require('../Controllers/Filemanager');


  
const {
  GetLoans,
  GetLoansKpis,
  GetActiveLoansByUser,
  GetLoanHistoryByUser,
  SearchUsersLoans,
  SearchExemplars,
  RegisterLoan,
  QuickLoan,
  ReturnLoan,
  RenewLoan,
  DeleteLoan,
} = require('../Controllers/LibraryLoans');


 
const {
  GetReservations,
  GetReservationsKpis,
  GetReservationsChart,
  GetAvailableBooksForReservation,
  GetReservationHistoryByUser,
  RegisterReservation,
  ConfirmReservation,
  CancelReservation,
  DeleteReservation,
  GetMyReservations,
  RegisterReservationSimple
} = require('../Controllers/LibraryReservations');
 
 const { GetFinalPautas, GetSingleFinalPauta, RegisterFinalPauta, UpdateFinalPauta, DeleteFinalPauta } = require("../Controllers/FinalPautasController");


 

   const {
     GetGradeHistory, CreateGradeHistory,
     UpdateGradeHistory, DeleteGradeHistory,
   } = require("../Controllers/StudentGradeHistory");


   const {
  GetLibraryFineRules, CreateLibraryFineRule, UpdateLibraryFineRule,
  ToggleLibraryFineRule, DeleteLibraryFineRule,
  GetLibraryFineExclusions, AddLibraryFineExclusion, RemoveLibraryFineExclusion,
  GetFinesLIB, GetFineById, GetFinesKpis, GetFinesDashboard, PreviewFineForLoan,
  CreateFine, PayFine, ExemptFine, DeleteFine,
  SearchUsersForFines, SearchLoansForFines,
  RunLibraryFineEngine, initLibraryFineCron,
} = require("../Controllers/LibraryFines");


  
 const ExecuteQuery = require("../Functions/ExecuteQuery"); 
const { GetInvoices, GetSingleInvoice, GetInvoiceByCode, GetInvoiceByVendusNumber, RegisterInvoice, InvoiceDelete, InvoiceUpdate } = require("../Controllers/Invoices");


router.get("/" ,  (req, res)=>{
   res.send("Hello my greatest friennds !");
})

router.get("/token", RefreshToken);

const CacheLimitTime_one = 300;
const CacheLimitTime_two = 60;



router.post("/api/session/network-mode/:MODE",  VerifyToken, UpdateNetworkMode);
router.get("/api/session/network-mode", VerifyToken, GetCurrentNetworkMode);

 

router.post("/api/sync/table",  VerifyToken, async (req, res) => {
  try {
    const { table, mode, tenant } = req.body;

    if (!table) return res.status(400).json({ error: "Falta 'table'" });
    if (!mode) return res.status(400).json({ error: "Falta 'mode'" });

    // tenant do body = NOME DA COLUNA (ou null se tabela não tiver tenant) 
    setTenantCode(tenant); 
    const tenantValue =
      req.session?.user?.eduall_user_session_curentinstitute || null;

    let result;

    if (mode === "upload") {
      result = await syncUploadSingleTable(table, tenantValue);
    } else if (mode === "download") {
      result = await syncDownloadSingleTable(table, tenantValue);
    } else {
      return res
        .status(400)
        .json({ error: "mode deve ser 'upload' ou 'download'" });
    }

    res.json(result);
  } catch (err) {
    console.error("[SYNC TABLE] Erro:", err);
    res.status(500).json({ error: err.message });
  }
});



 
router.get("/eduall-final-pautas/get", VerifyToken, GetFinalPautas);
router.get("/eduall-final-pautas/get/:ID", VerifyToken, GetSingleFinalPauta);
router.post("/eduall-final-pautas/post", VerifyToken, RegisterFinalPauta);
router.put("/eduall-final-pautas/update/:ID", VerifyToken, UpdateFinalPauta);
router.put("/eduall-final-pautas/delete/:ID", VerifyToken, DeleteFinalPauta);

 
//============= RFID básicas
router.get("/eduallrfid/read/:code",VerifyToken, AutoDBSetup, RFIDRead);
router.post("/eduallrfid/assign/student/:ID",VerifyToken, AutoDBSetup, AssignStudentRFID);
router.post("/eduallrfid/assign/employee/:ID", VerifyToken, AutoDBSetup, AssignEmployeeRFID);
router.get("/eduallrfid/generate", VerifyToken, AutoDBSetup, GenerateRFIDCode);
router.post("/eduallrfid/log/register", AutoDBSetup, RegisterRFIDLog);
router.get("/eduallrfid/logs/get", AutoDBSetup, GetRFIDLogs);

//=============   FULL INFO POR RFID
router.get("/eduallrfid/fullinfo/:code", VerifyToken, AutoDBSetup, RFIDFullInfo);

//=============  Suspensões
router.post("/eduallsuspensions/register", VerifyToken, AutoDBSetup, CreateSuspension);
router.put("/eduallsuspensions/update/:ID", VerifyToken, AutoDBSetup, UpdateSuspension);
router.put("/eduallsuspensions/lift/:ID", VerifyToken, AutoDBSetup, LiftSuspension);
router.delete("/eduallsuspensions/delete/:ID", VerifyToken, AutoDBSetup, DeleteSuspension);
router.get("/eduallsuspensions/check/:studentId", VerifyToken, AutoDBSetup, CheckSuspension);
router.get("/eduallsuspensions/by-student/:studentId", VerifyToken, AutoDBSetup, ListSuspensionsByStudent);
router.get("/eduallsuspensions/getallsuspensions", VerifyToken, AutoDBSetup, GetAllSuspensions);

//============ pagamentos antigos =======//
 
router.get("/edualloldpayments/get/", VerifyToken, GetOldPayments); 
router.get("/edualloldpayment/get/:ID", VerifyToken, GetSingleOldPayment); 
router.post("/edualloldpaymentregister/post/", VerifyToken, RegisterOldPayment); 
router.put("/edualloldpaymentupdate/update/:ID", VerifyToken, UpdateOldPayment); 
router.put("/edualloldpaymentdelete/delete/:ID", VerifyToken, DeleteOldPayment);


//============= Aulas da eduall ========//
router.get("/api/lessons", VerifyToken, cacheMiddleware(CacheLimitTime_one) , GetLessons_ED); 
router.get("/api/lessons/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_one) , GetSingleLesson_ED);
router.post("/api/lessons/register", VerifyToken, cacheMiddleware(CacheLimitTime_one)  , RegisterLesson_ED);
router.put("/api/lessons/update/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_one) , LessonUpdate_ED);
router.delete("/api/lessons/delete/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_one)  , LessonDelete_ED);



//============= Noticias da eduall ========//
router.get("/news/videos",VerifyToken,cacheMiddleware(CacheLimitTime_one),GetNewsVideos); 
router.post("/news/videos",VerifyToken, RegisterNewsVideo);
router.put("/news/videos/:ID/seen",  VerifyToken, cacheMiddleware(CacheLimitTime_one),MarkNewsAsSeen); 
router.get("/news/unseen/latest", VerifyToken, GetLatestUnseenNews);
 
 
// ========== USUÁRIOS ==========
router.get('/eduallusersaccounts/get/', VerifyToken, getUsers);
router.get('/students/get/', GetSTDS);
router.get('/eduallcheckexistentuseraccountemail/:EMAIL', VerifyToken,  CheckExistentEmail);
router.get('/eduallsingleuserdata/get/:ID', VerifyToken,  getSingleUserData);
router.get('/eduallgetuserimagebyuser/get/:EMAIL',  getSingleUserImageData);
router.get('/eduallgetcurrentuserdata/get/', VerifyToken, getCurrentUserInformation);
router.get('/eduallsearchusers/search/:TEXT', VerifyToken,  SearchUsers);
router.get('/eduallgetuseraccess/get/:ID', VerifyToken,  GetUserAccounAccess);
router.get('/eduallgetsinglesystemuseracccount/get/:ID', VerifyToken,  GetSingleInstituteUserAccount);
router.get('/eduallinstituteuseraccountsget/get', VerifyToken, GetInstituteUserAccounts);



 
// =========================. emprestimos biblioteca =====================//
router.get('/edualllibraryloans/get', VerifyToken, GetLoans);
router.get('/edualllibraryloans/kpis', VerifyToken, GetLoansKpis);
router.get('/edualllibraryloans/active/:USER_ID', VerifyToken, GetActiveLoansByUser);
router.get('/edualllibraryloans/history/:USER_ID', VerifyToken, GetLoanHistoryByUser);
router.get('/edualllibraryloans/users/search', VerifyToken, SearchUsersLoans);
router.get('/edualllibraryloans/exemplars/search', VerifyToken, SearchExemplars);
router.post('/edualllibraryloans/register', VerifyToken, RegisterLoan);
router.post('/edualllibraryloans/quick', VerifyToken, QuickLoan);
router.put('/edualllibraryloans/return/:ID', VerifyToken, ReturnLoan);
router.put('/edualllibraryloans/renew/:ID', VerifyToken, RenewLoan);
router.delete('/edualllibraryloans/delete/:ID', VerifyToken, DeleteLoan);

// ========== GESTOR DE FICHEIROS ==========
router.get( '/filemanager/folders',              VerifyToken, GetFolderTree);
router.get( '/filemanager/contents',             VerifyToken, GetRootContents);
router.get( '/filemanager/contents/:FOLDER_ID',  VerifyToken, GetFolderContents);
router.get( '/filemanager/download/:ID',         VerifyToken, DownloadFile);
router.get( '/filemanager/stats',                VerifyToken, GetStats);
router.post('/filemanager/folders',              VerifyToken, CreateFolder);
router.post('/filemanager/upload',               VerifyToken, uploadFileManagerFiles, UploadFiles);
router.post('/filemanager/paste',                VerifyToken, PasteItem);
router.put( '/filemanager/rename/:ID',           VerifyToken, RenameItem);
router.delete('/filemanager/delete',             VerifyToken, DeleteItems);


 


// Rotas POST, PUT, DELETE (sem cache)
router.post('/eduallusersaccountsignup/post', RegisterUserAccount);
router.post('/login', Login);
router.post('/google-auth', GoogleAuth);
router.post('/eduallpasswordupdate', UpdateUserPassword);
router.put('/eduallchnagecurrentuserpassword/update', VerifyToken, ResetUserPasswordWhileLoggedin);
router.put('/eduallchangecurrentuserinformation/update', VerifyToken, uploadUserAccountPicture, UpdateUserAccountWhileLoggedin);
router.put('/edualluseraccountupdate/update/:ID', VerifyToken, UpdateUserAccount);
router.put('/edualluserinstituteaccountdelete/delete/:ID', VerifyToken, DeleteUserInstituteAccount);
router.put('/edualluserinstituteaccountupdate/update/:ID', VerifyToken, UpdateInstituteUserAccount);
router.put('/eduallprofilepictureupdate/update/', VerifyToken, uploadUserAccountPicture, UPDATEProfilePicture);
router.put('/eduallprofilecoverimageupdate/update/', VerifyToken, uploadUserAccountBackgroundPicture, UPDATEProfileCoverImage);
router.post('/eduallpasswordreset', UserPasswordReset);
router.post('/edualluseraccountverificationcode/post', CheckUserAccountVerificationCode);
router.put('/eduallchangecurrentuserpassword', VerifyToken, ChangeCurrentUserPassword);





//// contas do sistema e aceso a apps
router.post('/eduallinstituteuseraccountregister/post', RegisterInstituteUserAccount);







// Logout
router.delete('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ msg: "Error during logout." });
    res.clearCookie("connect.sid");

    console.log("user session = ", req.session?.user);
    return res.json({ msg: "Logged out successfully." });
  });
});



 
// ── Datas dos trimestres (ano académico) ────────────────────────────────────
router.get('/eduallacademicyeartermdates/get/:ID',   VerifyToken, GetAcademicYearTermDates);
router.put('/eduallacademicyeartermdates/put/:ID',   VerifyToken, SetAcademicYearTermDates);
 
// ── Mapa de Aproveitamento ──────────────────────────────────────────────────
router.post('/eduallgetperformancemap/get/',              VerifyToken, GetPerformanceMap);
router.post('/eduallsaveperformancemap/post',             VerifyToken, SavePerformanceMap);
router.get ('/eduallgetsavedperformancemaps/get',         VerifyToken, GetSavedPerformanceMaps);
router.get ('/eduallgetsingleperformancemap/get/:ID',     VerifyToken, GetSingleSavedPerformanceMap);
router.put ('/edualldeleteperformancemap/delete/:ID',     VerifyToken, DeleteSavedPerformanceMap);

 


// ========== DASHBOARD (ESTUDANTES) ==========
router.post("/eduallbulkstudentaccounts/post", VerifyToken, RegisterBulkStudentUserAccounts);
router.post("/eduallresetstudentaccountpassword/post", VerifyToken, ResetStudentPasswordController);

// Registar / reverter transferência de um aluno
router.put('/eduallstudenttransfer/put/:ID', VerifyToken, StudentTransferUpdate); 
router.get('/eduallstudenttransferstatus/get/:ID', VerifyToken, GetStudentTransferStatus); 
router.get('/eduallstudenttransferhistory/get/:ID', VerifyToken, GetStudentTransferHistory); 
router.get('/eduallstudentstransferred/get', VerifyToken, GetTransferredStudents);


router.put('/eduallstudentclassupdate/put/:ID', VerifyToken, StudentClassUpdate); 
router.put('/eduallstudentbulkupdate/put', VerifyToken, StudentBulkUpdate); 
router.put("/eduallstudentdropout/put/:ID", VerifyToken, StudentDropoutUpdate);
router.get('/eduallstudentsapi/get', VerifyToken,   GetStudents);
router.get('/eduallsinglestudentapi/get/:ID', VerifyToken,  GetSingleStudent);
router.get('/eduallgetstudentsbyclass/:CLASS', VerifyToken,  GetStudentsByClass);
router.get("/eduallgetstudentspassengersbyclass/:CLASS", VerifyToken,  GetTransportPassengersByClass)
router.get('/eduallgetinstitutestudentsbycode/get/:CODE', VerifyToken,  GetStudentsByInstitute);
router.get('/eduallgetsinglestudentbycode/get/:CODE', VerifyToken,  GetSingleStudentByCode);
router.get('/eduallgetstudentbyidenitycard/get/:IDENTITITYCARD', VerifyToken,  GetSingleStudentByIdentityCard);
router.get('/eduallenrollmentconfirmations/get', VerifyToken, GetEnrollmentConfirmations);
router.get('/eduallgetsingleenrollmentconfirmation/get/:ID', VerifyToken,  GetSingleEnrolledConfirmation);
router.get('/eduallgetenrollmentconfirmationbycode/get/:CODE', VerifyToken,  GetSingleEnrolledConfirmationByCode);
router.get('/eduallstudentenrollments/get', VerifyToken , GetEnrolledStudents);
router.get('/eduallgetsingleenrolledstudent/get/:ID', VerifyToken,  GetSingleEnrolledStudent);
router.get('/eduallgetsingleenrolledstudentbycode/get/:CODE', VerifyToken,  GetSingleEnrolledStudentByCode);

// Rotas POST, PUT, DELETE estudantes (sem cache)
router.post('/eduallstudentregisterapi/post', VerifyToken, uploadStudentPicture, RegisterStudent);
router.post("/eduallstudentduplicate/duplicate/:id", VerifyToken, DuplicateStudent);
router.put('/eduallstudentdelete/delete/:ID', VerifyToken, StudentDelete);
router.put('/eduallstudentupdate/update/:ID', VerifyToken, uploadStudentPicture, StudentUpdate);
router.put('/eduallstudentupdateclass/update/:ID', VerifyToken, StudentUpdateClass);
router.put('/eduallstudentenrollmentupdate/update/:ID', VerifyToken, EnrolledStudentUpdate);
router.put('/eduallstudentenrollmentconfirmationupdate/update/:ID', VerifyToken, EnrollmentConfirmationUpdate);
router.post('/eduallregisterstudentenrollmentconfirmation/post', VerifyToken, RegisterEnrollmentConfirmation);
router.put('/eduallenronllmentconfirmationdelete/delete/:ID', VerifyToken, EnrollmentConfirmationDelete);
router.post('/eduallstudentenrollmentregister/post', VerifyToken, RegisterEnrollment);
router.put('/eduallenrollmentconfirmationcancel/delete/:ID', VerifyToken, EnrolledStudentDelete);


// ========== declarações ==========
router.get("/edualldeclarations/get/", VerifyToken ,   GetDeclarations);
router.post("/edualldeclarationregister/post/", VerifyToken ,   RegisterDeclaration);
router.get("/eduallgetsingledeclaration/get/:ID", VerifyToken ,   GetSingleDeclaration);
router.put("/edualldeclarationdelete/delete/:ID", VerifyToken ,   DeclarationDelete);
router.put("/edualldeclarationupdate/update/:ID", VerifyToken ,   DeclarationUpdate);

// ─── Rotas — Publicações Científicas ───────────────────────────────────────── 
router.get('/eduallscipubget/get/', VerifyToken, GetScientificPublications); 
router.post('/eduallscipubregister/post/', VerifyToken, uploadScientificPublicationFile, RegisterScientificPublication); 
router.get('/eduallscipubsingle/get/:ID', VerifyToken, GetSingleScientificPublication); 
router.put('/eduallscipubdelete/delete/:ID', VerifyToken, ScientificPublicationDelete); 
router.put('/eduallscipubupdate/update/:ID', VerifyToken, uploadScientificPublicationFile, ScientificPublicationUpdate);
 
 
 

// ========== EMAILS ==========
router.get('/eduallemails/get', VerifyToken, GetEmails);

// ========== CALENDÁRIO ==========
router.get('/eduallgetcalendarevents/get', VerifyToken, GetCalendarEvents);
router.get('/eduallgetsinglecalendarevent/get/:ID', VerifyToken,  GetSingleCalendarEvent);

// POST e PUT calendário (sem cache)
router.post('/eduallcalendarevenregister/post', VerifyToken, RegisterCalendarEvent);
router.put('/eduallcalendareventdelete/delete/:ID', VerifyToken, CalendarEventDelete);
router.put('/eduallupdatecalendarevent/update/:ID', VerifyToken, CalendarEventUpdate);

// ========== TURMAS ==========
router.get('/eduallclassapi/get', VerifyToken, GetClass);
router.patch('/eduallclassapi/transport/updateall', VerifyToken, UpdateAllClassesTransport);
router.get('/eduallsingleclassapi/get/:ID', VerifyToken,  GetSingleClass);
router.get('/eduallgetsingleclassdata/get/:ID', VerifyToken,  GetClassInformation);

// POST, PUT, DELETE turmas (sem cache) 
router.post('/eduallclassregisterapi/post', VerifyToken, RegisterClass);
router.put('/eduallclassdelete/delete/:ID', VerifyToken, ClassDelete);
router.put('/eduallclassupdate/update/:ID', VerifyToken, ClassUpdate);



// ========== DECLARAÇÕES DE HABILITAÇÕES ==========
router.get ('/eduall-qualifications-statement/get',          VerifyToken, GetAllQualificationsStatements);
router.get ('/eduall-qualifications-statement/get/:ID',      VerifyToken, GetQualificationsStatementById);
router.post('/eduall-qualifications-statement/post',         VerifyToken, RegisterQualificationsStatement);
router.put ('/eduall-qualifications-statement/update/:ID',   VerifyToken, UpdateQualificationsStatement);
router.put ('/eduall-qualifications-statement/delete/:ID',   VerifyToken, DeleteQualificationsStatement);

// ========== GUIAS DE TRANSFERÊNCIA ==========
router.get ('/eduall-transfer-guides/get',          VerifyToken, GetAllTransferGuides);
router.get ('/eduall-transfer-guides/get/:ID',      VerifyToken, GetTransferGuideById);
router.post('/eduall-transfer-guides/post',         VerifyToken, RegisterTransferGuide);
router.put ('/eduall-transfer-guides/update/:ID',   VerifyToken, UpdateTransferGuide);
router.put ('/eduall-transfer-guides/delete/:ID',   VerifyToken, DeleteTransferGuide);

// ========== CERTIFICADOS ESCOLARES ==========
router.get ('/eduall-certificates/get',          VerifyToken, GetAllCertificates);
router.get ('/eduall-certificates/get/:ID',      VerifyToken, GetCertificateById);
router.post('/eduall-certificates/post',         VerifyToken, RegisterCertificate);
router.put ('/eduall-certificates/update/:ID',   VerifyToken, UpdateCertificate);
router.put ('/eduall-certificates/delete/:ID',   VerifyToken, DeleteCertificate);

// ========== CURSOS ==========
router.get('/eduallcoursesapi/get', VerifyToken, GetCourse);
router.get('/eduallsinglecoursesapi/get/:ID', VerifyToken,  GetsingleCourse);

// POST, PUT, DELETE cursos (sem cache)
router.post('/eduallcourseregisterapi/post', VerifyToken, RegisterCourse);
router.put('/eduallcoursedelete/delete/:ID', VerifyToken, CourseDelete);
router.put('/eduallcourseupdate/update/:ID', VerifyToken, CourseUpdate);

// ========== ANO ACADÊMICO ==========
router.get('/eduallacademicyearapi/get', VerifyToken, GetAcademicYear);
router.get('/eduallsingleacademicyearapi/get/:ID', VerifyToken,  GetSingleAcademicYear);
router.get('/eduallstudentoldclassesapi/get', VerifyToken, GetStudentOldClasses);


// POST, PUT, DELETE ano acadêmico (sem cache)
router.post('/eduallacademicyeargisterapi/post', VerifyToken, RegisterAcademicYear);
router.put('/eduallacademicyeardelete/delete/:ID', VerifyToken, AcademicyearDelete);
router.put('/eduallacademicyearupdate/update/:ID', VerifyToken, AcademicyearUpdate);

// ========== SALAS ==========
router.get('/eduallclassroomapi/get', VerifyToken, GetClassroom);
router.get('/eduallsingleclassroomapi/get/:ID', VerifyToken,  GetSingleClassroom);

// POST, PUT, DELETE salas (sem cache)
router.post('/eduallclassroomregisterapi/post', VerifyToken, RegisterClassRoom);
router.put('/eduallclassroomdelete/delete/:ID', VerifyToken, ClassRoomDelete);
router.put('/eduallclassroomupdate/update/:ID', VerifyToken, ClassRoomUpdate);

// ========== CICLOS ========== 

// POST, PUT, DELETE ciclos (sem cache)
router.post('/eduallcicleregister/post', VerifyToken, RegisterCicle);
router.put('/eduallcicledelete/delete/:ID', VerifyToken, CicleDelete);
router.put('/eduallcicleupdate/update/:ID', VerifyToken, CicleUpdate); 
router.get('/eduallciclesapi/get', VerifyToken, GetCicles);
router.get('/eduallsinglecicle/get/:ID', VerifyToken,  GetSingleCicle);

// ========== DISCIPLINAS ==========
router.get('/eduallsubjectsapi/get', VerifyToken, GetSubjects);
router.get('/eduallsinglesubject/get/:ID', VerifyToken,  GetSingleSubject);
router.post('/eduallsubjectregisterapi/post', VerifyToken, RegisterSubject);
router.put('/eduallsubjectdelete/delete/:ID', VerifyToken, SubjectDelete);
router.put('/eduallsubjectupdate/update/:ID', VerifyToken, SubjectUpdate);
router.post("/eduallclass/add-subject", VerifyToken, AddSubjectToClass); 
router.post("/eduallclass/remove-subject",VerifyToken, RemoveSubjectFromClass);
router.get( "/eduallclasses/subjects/byclass2/:classID", VerifyToken, GetSubjectsByClass2); 
router.post("/eduallclass/toggle-key-subject", VerifyToken, ToggleKeySubject);
router.post('/eduallclass/update-subject-average', VerifyToken, UpdateSubjectAverage); 
router.post('/eduallclass/update-subject-behavior', VerifyToken, UpdateSubjectBehavior);

 

// ========== ERROS E FEEDBACKS ==========
router.get("/edualldebugfeedback/get/", GetFeedbacks);
router.get("/edualldebugfeedback/get/:ID", GetSingleFeedback);
router.post("/edualldebugfeedback/post/", UploadMiddleware.array("files"), RegisterFeedback);
router.delete("/edualldebugfeedback/delete/:ID", DeleteFeedback);

 
 

// ========== SERVIÇOS ==========
router.get('/eduallservicesapi/get', VerifyToken, GetServices);
router.get('/eduallsingleserviceapi/get/:ID', VerifyToken,  GetSingleService);

// POST, PUT, DELETE serviços (sem cache)
router.post('/eduallserviceregisterapi/post', VerifyToken, RegisterService);
router.put('/eduallservicedelete/delete/:ID', VerifyToken, ServiceDelete);
router.put('/eduallserviceupdate/update/:ID', VerifyToken, ServiceUpdate);
router.put('/eduallupdateservicediscount/update/:ID', VerifyToken, ServiceUpdateDiscountData);

 

router.get('/eduallfeepaymentsapi/get/', VerifyToken, GetFeepayments);
router.get('/eduallfeepaymentsingle/get/:ID', VerifyToken,  GetSinglePayment);
router.get('/eduallfeepaymentcheckpaidmonth/:MONTH,:STUDENTCODE,:SERVICE', VerifyToken,  GetSinglePaidMonth);
router.get('/eduallsinglestudentfeepayment/get/:STUDENTCODE,:ACADEMICYEAR', VerifyToken,  GetSingleStudentFees);
router.get('/eduallGetAllClassesPaymentsStatus/get/', VerifyToken,  GetAllClassesPaymentsStatus);
router.get('/eduallGetAllClassestransportaymentsStatus/get/', VerifyToken,  GetAllClassesTransportPaymentsStatus);
router.get('/eduallGetAllClasstransportaymentsStatus/get/:classId', VerifyToken,  GetClassTransportPaymentsStatus);
router.get('/eduallGetAllClassfeepaymentsStatus/get/:classId', VerifyToken,  GetClassPaymentsStatusById); 
router.get("/eduallfeepayments/get/student/:studentCode", VerifyToken,   GetSingleStudentPaymentStatus);
router.get("/eduallfeepayments/get/student/rfid/:rfidCode", VerifyToken, GetSingleStudentPaymentStatusByRFID);
 

router.get ('/eduallbordereaucheck/get/:NUMBER',  VerifyToken, CheckBordereauStatus);
router.get ('/eduallbordereaudetail/get/:NUMBER', VerifyToken, GetBordereauDetail);
router.post('/eduallbordereausetvalue/post',      VerifyToken, SetBordereauOriginalValue);



router.get   ("/eduall-grade-history/get/:STUDENT_ID", VerifyToken, GetGradeHistory);
router.post  ("/eduall-grade-history/post",             VerifyToken, CreateGradeHistory);
router.put   ("/eduall-grade-history/update/:ID",       VerifyToken, UpdateGradeHistory);
router.delete("/eduall-grade-history/delete/:ID",       VerifyToken, DeleteGradeHistory);




 

 
 
// Rota 1: Registar pagamento de serviço (sem middleware de upload)
router.post('/eduallregisterservicepayment/post', VerifyToken, RegisterServicePayment); 
router.put('/eduallservicepaymentdelete/delete/:ID', VerifyToken, ServicePaymentDelete); 
router.put('/eduallservicepaymentupdate/update/:ID', VerifyToken, ServicePaymentUpdate);  
router.get('/eduallservicepaymentsapi/get', VerifyToken, GetServicePayments); 
router.get('/eduallsingleservicepaymentapi/get/:ID', VerifyToken, GetSingleServicePayment); 
router.get('/eduallservicestudentpayments/get/:STUDENTID', VerifyToken, GetStudentServicePayments); 
router.put('/eduallservicedeleteservice/delete/:SERVICEID', VerifyToken, DeleteServiceWithFees); 
router.get('/eduallservicegeneratereceipt/:PAYMENTCODE', VerifyToken, GenerateReceiptWithFees);


router.put('/eduallfeepaymentsdelete/delete/:ID', VerifyToken, FeePaymentDelete);
router.put('/eduallfeepaymentupdate/update/:ID', VerifyToken, FeePaymentUpdate); 
router.post('/eduallregisterfeepayment/post', VerifyToken, RegisterFeepayment); 
router.post('/eduallfeeimport/single', VerifyToken, ImportSinglePayment);
router.post('/eduallfeeimport/batch',  VerifyToken, ImportBatchPayments);

 

// ========== NÍVEIS ACADÊMICOS ==========
router.get('/eduallacademiclevelsapi/get', VerifyToken, GetAcademicLevel);
router.get('/eduallsingleacademiclevelsapi/get/:ID', VerifyToken,  GetSingleAcademicLevel);
router.get('/eduallacademiclevelsapibygender/get', VerifyToken, GetStudentsByAcademicLevel);

// POST, PUT, DELETE níveis acadêmicos (sem cache)
router.post('/eduallregisteracademiclevel/post', VerifyToken, RegisterAcademicLevel);
router.put('/eduallacademicleveldelete/delete/:ID', VerifyToken, AcademicLevelDelete);
router.put('/eduallacademiclevelupdate/update/:ID', VerifyToken, AcademicLevelUpdate);



router.get("/api/vendus/invoices/:id/pdf", VENUDS_GetInvoicePdf);



// ========== FORNECEDORES ==========
router.get('/eduallprovidersapi/get/', VerifyToken, GetProviders);
router.get('/eduallgetsingleprovider/get/:ID', VerifyToken,  GetSingleProvider);

// POST, PUT, DELETE fornecedores (sem cache)
router.post('/eduallregisterprovider/post/', VerifyToken, RegisterProvider);
router.put('/eduallproviderdelete/delete/:ID', VerifyToken, ProviderDelete);
router.put('/eduallproviderupdate/update/:ID', VerifyToken, ProviderUpdate);

// ========== HORÁRIOS ==========
router.get('/edualltimings/get/', VerifyToken, GetTimings);
router.get('/eduallgetsingletiming/get/:ID', VerifyToken,  GetSingleTiming);
router.get('/eduallgetclasstimings/get/:CODE', VerifyToken,  GetAllClassTimings);

// POST, PUT, DELETE horários (sem cache)
router.post('/eduallregistertiming/post/', VerifyToken, RegisterTiming);
router.put('/edualltimingdelete/delete/:ID', VerifyToken, TimingDelete);
router.put('/edualltimingupdate/update/:ID', VerifyToken, TimingUpdate);

// ========== ESCOLAS DE PROCEDÊNCIA ==========
router.get('/eduallschoolsofprovenance/get/', VerifyToken, GetSchoolsOfProvenance);
router.get('/eduallgetsingleschoolofprovenance/get/:ID', VerifyToken,  GetSingleSchoolsOfProvenance);

// POST, PUT, DELETE escolas de procedência (sem cache) 
router.post("/eduallregisterschoolofprovenance/post/", VerifyToken, RegisterSchoolsOfProvenance); 
router.put("/eduallschoolofprovenancedelete/delete/:ID", VerifyToken, SchoolsOfProvenanceDelete);
router.put("/eduallschoolofprovenanceupdate/update/:ID", VerifyToken, SchoolsOfProvenanceUpdate);

 
 // --- CONTATOS ---
router.post("/eduallregisterinstitutecontact/post", VerifyToken, uploadContactPicture, RegisterContact);

router.get("/eduallgetinstitutecontacts/get", VerifyToken, GetContacts);
router.get("/eduallgetcontactmessagebycontactemail/get/:EMAIL", VerifyToken,  GetContactMessagesByContact);
router.get("/eduallgetsinglecontact/get/:ID", VerifyToken,  GetSingleContact);

router.put("/eduallcontactdelete/delete/:ID", VerifyToken, ContactDelete);
router.put("/eduallcontactupdate/update/:ID", VerifyToken, uploadContactPicture, ContactUpdate);

// --- TRANSPORTE ---
router.post("/eduallregistetransportpayment/post/", VerifyToken, RegisterTransportPayments);

router.get("/edualltransportpaymentsapi/get/", VerifyToken, GetTransportPayments);
router.get("/edualltransportpaymentsingle/get/:ID", VerifyToken,  GetSingleTransportPayment);

router.get("/edualltransportpaymentcheckpaidmonth/:MONTH,:STUDENTCODE,:YEAR", VerifyToken,  GetSingleTransportPaidMonth);
router.get("/eduallsinglestudenttransportpayment/get/:PASSENGERCODE,:ACADEMICYEAR", VerifyToken,  GetSingleStudentTransportPayments);
router.get("/eduallgetstudenttransportpaymentsbycode/get/:STUDENTCODE,:ACADEMICYEAR", VerifyToken,  GetSingleStudentTransportPaymentsByCode);
router.get("/eduallsinglestudenttransportpayment/get/rfid/:RFIDCODE",VerifyToken, GetSingleStudentTransportPaymentsByRFID);

router.put("/edualltransportpaymentsdelete/delete/:ID", VerifyToken, TransportPaymentsDelete);
router.put("/edualltransportpaymentupdate/update/:ID", VerifyToken, TransportPaymentsUpdate);

// --- CARGOS ---
router.get("/eduallgetjobtitles/", VerifyToken, GetJobTitles);
router.get("/eduallgetsinglejobtitle/get/:ID", VerifyToken,  GetSingleJobTitle);

// --- MOEDAS ---
router.get("/eduallcoinsapi/get/", VerifyToken, GetCoins);
router.post("/eduallregistercoins/post/", VerifyToken, RegisterCoin);
router.put("/eduallcoindelete/delete/:ID", VerifyToken, CoinDelete);
router.get("/eduallsinglecoinget/get/:ID", VerifyToken,  GetSingleCoin);
router.put("/eduallcoinupdate/update/:ID", VerifyToken, CoinUpdate);

// --- PRODUTOS ---
router.post("/eduallproductsregister/post", VerifyToken, uploadProductPicture, RegisterProducts);
router.get("/eduallproductsapi/get/", VerifyToken, GetProducts);
router.get("/eduallsingleproductapi/get/:ID", VerifyToken,  GetSingleProduct);
router.put("/eduallproductdelete/delete/:ID", VerifyToken, ProductDelete);
router.put("/eduallproductupdate/update/:ID", VerifyToken, uploadProductPicture, ProductUpdate);

// --- FUNCIONÁRIOS ---
router.get("/eduallemployeesget/get/", VerifyToken, Getemployees);
router.get("/eduallgetemployeebyjobtitle/get/:CODE", VerifyToken,  GetEmployeeByJobTitle);
router.get("/eduallsinglemployee/get/:ID", VerifyToken,  GetSingleEmployee);

router.post("/eduallemployeeregister/post/", VerifyToken, uploadEmployeePicture, RegisterEmployee);
router.put("/eduallemployeedelete/delete/:ID", VerifyToken, EmployeeDelete);
router.put("/eduallemployeeupdate/update/:ID", VerifyToken, uploadEmployeePicture, EmployeeUpdate);

router.get("/eduallgetsingleuserandemployeedata/get", VerifyToken, GetEmployeeDataByUser);

// --- PROFESSORES E DISCIPLINAS ---
router.get("/eduallgetteachersubjects/get/:CODE", VerifyToken,  GetTeacherSubjects);
router.get("/eduallgetsingleteachersubjects/get/:CODE,:ID,:CLASS", VerifyToken,  GetSingleTeacherSubject);
router.get("/eduallGetSingleTeacherSubjectById/get/:ID", VerifyToken,  GetSingleTeacherSubjectById);

router.post("/eduallregisterteachersubject/post/", VerifyToken, RegisterTeacherSubject);
router.put("/eduallteachersubjectdelete/delete/:ID", VerifyToken, TeacherSubjectDelete);

router.get("/eduallgetallteachersubjects/get", VerifyToken, GetTeacherSubjectsData);
router.get("/eduallgetallteachertimings/get", VerifyToken, GetTeacherTimingsData);


router.post("/eduallregisterteachersubject/bulk/post", VerifyToken, RegisterTeacherSubjectBulk); 
router.post("/eduallteachertimingregister/bulk/post", VerifyToken, RegisterTeacherTimingBulk);
router.post("/eduallregisterteacherassignments/bulk/post", VerifyToken, RegisterTeacherAssignmentsBulk)

router.put("/eduallteachersubjectupdate/update/:ID", VerifyToken, UpdateTeacherSubject);
router.put("/eduallteachertimingupdate/update/:ID", VerifyToken, UpdateTeacherTiming);

// --- LIVROS ---
router.get('/edualllibrarybooks/get', VerifyToken, GetBooks);
router.post('/edualllibrarybookregister/post', VerifyToken, uploadBookCover, RegisterBook);
router.get("/eduallsinglelibrarybook/get/:ID", VerifyToken,  GetSingleBook);
router.put("/edualllibrarybookdelete/delete/:ID", VerifyToken, BookDelete);
router.put("/edualllibrarybookupdate/update/:ID", VerifyToken, uploadBookCover, BookUpdate);



 
 

 

// --- EXEMPLARES ---
router.get('/edualllibraryexemplares/get',                VerifyToken, GetExemplares);
router.get('/edualllibraryexemplares/book/:BOOK_ID',      VerifyToken, GetExemplaresByBook);
router.get('/edualllibraryexemplar/get/:ID',              VerifyToken, GetSingleExemplar);
router.get('/edualllibraryexemplarscan/get/:code',        VerifyToken, GetExemplarByScan);
router.post('/edualllibraryexemplarregister/post',        VerifyToken, RegisterExemplar);
router.put('/edualllibraryexemplardelete/delete/:ID',     VerifyToken, DeleteExemplar);
router.put('/edualllibraryexemplarUpdate/update/:ID',     VerifyToken, UpdateExemplar);
router.put('/edualllibraryexemplarRFID/rfid/:ID',         VerifyToken, AssignRFID);
router.get('/edualllibraryexemplarqr/regenerate/:ID',     VerifyToken, RegenerateQR);
router.get('/edualllibraryexemplarRFID/generate',         VerifyToken, GenerateRFID);


router.get ('/edualllibraryRFIDmovements/get',               VerifyToken, GetRFIDMovements);
router.get ('/edualllibraryRFIDmovements/kpis',              VerifyToken, GetRFIDMovementsKpis);
router.get ('/edualllibraryRFIDmovements/exemplar/:EXEMPLAR_ID', VerifyToken, GetMovementsByExemplar);
router.get ('/edualllibraryRFIDmovements/anomalies',         VerifyToken, GetActiveAnomalies);
router.post('/edualllibraryRFIDmovements/register',          VerifyToken, RegisterRFIDEvent);
router.post('/edualllibraryRFIDmovements/batch',             VerifyToken, RegisterRFIDBatch);
router.put ('/edualllibraryRFIDmovements/resolve/:ID',       VerifyToken, ResolveAnomaly);
router.put ('/edualllibraryRFIDmovements/delete/:ID',        VerifyToken, DeleteRFIDMovement);

//  // — Antenas RFID —
router.get ('/edualllibraryRFIDantennas/get',                VerifyToken, GetAntennas);
router.post('/edualllibraryRFIDantennas/register',           VerifyToken, RegisterAntenna);
router.put ('/edualllibraryRFIDantennas/update/:ID',         VerifyToken, UpdateAntenna);
router.put ('/edualllibraryRFIDantennas/delete/:ID',         VerifyToken, DeleteAntenna);
 





// --- ARQUIVOS ---
router.post("/eduallfilesregister/post/", VerifyToken, uploadFiles, RegisterFile);
router.get("/eduallsingleuserfiles/get/:CODE", VerifyToken,  GetSpecificFiles);
router.put("/eduallfiledelete/delete/:ID", VerifyToken, FileDelete);

// --- CLASSES ANTIGAS DOS ALUNOS ---
router.get("/eduallgetsinglestudentoldclasses/get/:CODE", VerifyToken,  GetSingleStudentOldClasses);
router.post("/eduallregisterstudentoldclass/post/", VerifyToken, RegisterOldClass);

// --- TRANSFERÊNCIA DE ALUNOS ---
router.post("/eduallstudenttransferenceregister/post", VerifyToken, RegisterStudentTransference);
router.get("/eduallstudenttransferences/get/", VerifyToken, GetStudentTransferences);
router.get("/eduallsinglestudenttransference/get/:ID", VerifyToken,  GetSingleStudentTransference);

router.put("/eduallstudenttransferencedelete/:ID", VerifyToken, StudentTransferenceDelete);
router.put("/eduallstudenttransferenceupdate/update/:ID", VerifyToken, StudentTransferenceUpdate);

// --- TÍTULOS E CABEÇALHOS ---
router.post("/edualltitlesandheadersregister/post", VerifyToken, RegisterTitleAndHeader);
router.get("/eduallgetsingletitleandheader/get/:ID", VerifyToken,  GetSingleTitleAndHeader);
router.get("/eduallgettitlesandheaders/get/", VerifyToken, GetTitleAndHeaders);
router.put("/edualltitleandheaderdelete/delete/:ID", VerifyToken, TitleAndHeaderDelete);
router.put("/edualltitleandheaderupdate/update/:ID", VerifyToken, TitleAndHeaderUpdate);

// --- OPERAÇÕES DE MATRÍCULA ---
router.post("/eduallenrolloperationregister/post", VerifyToken, RegisterEnrollOperation);
router.get("/eduallgetsingleenrolloperation/get/:ID", VerifyToken,  GetSingleEnrollOperation);
router.get("/eduallgetenrolloperations/get/", VerifyToken, GetEnrollOperations);
router.put("/eduallenrolloperationdelete/delete/:ID", VerifyToken, EnrollOperationDelete);
router.put("/eduallenrolloperationupdate/update/:ID", VerifyToken, EnrollOperationUpdate);

// --- PAIS / ENCARREGADOS ---
router.get('/eduallparents/get', VerifyToken, Getparents);
router.post('/eduallparentregister/post', VerifyToken, uploadParentPicture, RegisterParent);
router.get("/eduallsingleparent/get/:ID", VerifyToken,  GetSingleparent);
router.put("/eduallparentdelete/delete/:ID", VerifyToken, ParentDelete);
router.put("/eduallparenteupdate/update/:ID", VerifyToken, uploadParentPicture, ParentUpdate);

// --- AUTORES DE LIVROS ---
router.get('/edualllibraryauthor/get', VerifyToken, GetAuthors);
router.post('/edualllibraryauthorregister/post', VerifyToken, RegisterAuthor);
router.get("/eduallsinglelibraryauthor/get/:ID", VerifyToken,  GetSingleAuthor);
router.put("/edualllibraryauthordelete/delete/:ID", VerifyToken, AuthorDelete);
router.put("/edualllibraryauthorupdate/update/:ID", VerifyToken, AuthorUpdate);

// --- MATRÍCULAS DOS ALUNOS --- 
router.post('/eduallstudentenrollmentregister/post', VerifyToken, RegisterStudentEnrollment);
router.get("/eduallsinglestudentenrollment/get/:ID", VerifyToken,  GetSingleStudentEnrollment);
router.get("/eduallchecksinglestudentenrollment/get/:STUDENT", VerifyToken,  CheckExistentStudentEnrollment);
router.put("/eduallstudentenrollmentdelete/delete/:ID", VerifyToken, StudentEnrollmentDelete);
router.put("/eduallstudentenrollmentupdate/update/:ID", VerifyToken, StudentEnrollmentUpdate);

// --- EDITORAS ---
router.get('/edualllibrarypublishers/get', VerifyToken, GetPublishers);
router.post('/edualllibrarypublisherregister/post', VerifyToken, RegisterPublisher);
router.get("/eduallsinglelibrarypublisher/get/:ID", VerifyToken,  GetSinglePublisher);
router.put("/edualllibrarypublisherdelete/delete/:ID", VerifyToken, PublisherDelete);
router.put("/edualllibrarypublisherupdate/update/:ID", VerifyToken, PublisherUpdate);

// --- DECLARAÇÕES ---
router.get('/edualldeclarationrequests/get', VerifyToken, GetDeclarationRequests);
router.post('/edualldeclarationrequestregister/post', VerifyToken, RegisterDeclarationRequest);
router.get("/eduallsingledeclarationrequest/get/:ID", VerifyToken,  GetSingleDeclarationRequest);
router.put("/edualldeclarationrequestdelete/delete/:ID", VerifyToken, DeclarationRequestDelete);
router.put("/edualldeclarationrequestupdate/update/:ID", VerifyToken, DeclarationRequestUpdate);

// --- TIPOS DE LIVROS ---
router.get('/edualllibrarytypeofbooks/get', VerifyToken, GetTypeofbooks);
router.post('/edualllibrarytypeofbookregister/post/', VerifyToken, RegisterTypeofbook);
router.get("/eduallsinglelibrarytypeofbook/get/:ID", VerifyToken,  GetSingleTypeofbook);
router.put("/edualllibrarytypeofbookdelete/delete/:ID", VerifyToken, TypeofbookDelete);
router.put("/edualllibrarytypeofbookupdate/update/:ID", VerifyToken, TypeofbookUpdate);

// --- CATEGORIAS DE LIVROS ---
router.get('/edualllibrarytypecategories/get', VerifyToken, GetBookCategories);
router.post('/edualllibrarycategoryregister/post/', VerifyToken, RegisterBookCategory);
router.get("/eduallsinglelibrarycategory/get/:ID", VerifyToken,  GetSingleBookCategory);
router.put("/edualllibrarycategorydelete/delete/:ID", VerifyToken, BookCategoryDelete);
router.put("/edualllibrarycategoryupdate/update/:ID", VerifyToken, BookCategoryUpdate);

// --- ESTANTES ---
router.get('/edualllibraryracks/get', VerifyToken, GetRacks);
router.post('/edualllibraryrackregister/post', VerifyToken, RegisterRack);
router.get("/eduallsinglelibraryrack/get/:ID", VerifyToken,  GetSingleRack);
router.put("/edualllibraryrackdelete/delete/:ID", VerifyToken, RackDelete);
router.put("/edualllibraryrackupdate/update/:ID", VerifyToken, RackUpdate);

// --- COLEÇÕES DE LIVROS ---
router.get('/edualllibrarycollectiongetall/get', VerifyToken, GetBookCollections);
router.post('/edualllibrarycollectionregister/post', VerifyToken, RegisterBookCollection);
router.get("/edualllibrarygetsinglecollection/get/:ID", VerifyToken,  GetSingleBookCollection);
router.put("/edualllibrarydeletecollection/delete/:ID", VerifyToken, BookCollectionDelete);
router.put("/edualllibraryupdatecollection/update/:ID", VerifyToken, BookCollectionUpdate);

// --- LIVROS EMPRESTADOS ---
router.get('/edualllibraryborrowedbooks/get', VerifyToken, GetBorrowedBooks);
router.post('/edualllibraryborrowbookregister/post', VerifyToken, RegisterBorrowedBook);
router.get("/eduallsinglelibraryborrowedbook/get/:ID", VerifyToken,  GetSingleBorrowedBook);
router.put("/edualllibraryborrowedbookdelete/delete/:ID", VerifyToken, BorrowedBookDelete);
router.put("/edualllibraryborrowedbookupdate/update/:ID", VerifyToken, BorrowedBookUpdate);

// --- FEEDBACKS ---   
router.get('/eduallfeedbacks/get', VerifyToken ,   GetFeedBacks);
router.post('/eduallfeedbackregister/post', VerifyToken ,   RegisterFeedBack);
router.get("/eduallsinglefeedback/get/:ID", VerifyToken ,    GetSingleFeedback);
router.get("/eduallsingleusersfeedbacks/get", VerifyToken ,   GetSingleUserFeedback);
router.put("/eduallfeedbackdelete/delete/:ID", VerifyToken ,   FeedBackDelete);
router.put("/eduallfeedbackupdate/update/:ID", VerifyToken ,   FeedbackUpdate);  

 
// --- NOTAS ---  
router.get('/eduallquarterlynotes/get', VerifyToken ,   GetQuarterlyNotes);
router.post('/eduallquarterlynotesregister/post', VerifyToken ,   RegisterQuarterlyNote);




router.get("/eduallsemester-notes/list/:SEMESTER/:SUBJECT/:CLASS",VerifyToken ,   ListSemesterNotes);
router.get("/eduallquarterly-notes/list/:QUARTER/:SUBJECT/:CLASS", VerifyToken , ListQuarterlyNotes); 
router.post("/eduallsemester-notes/upsert", VerifyToken ,  RegisterSemesterNote);
router.post("/eduallquarterly-notes/upsert", VerifyToken ,  RegisterQuarterlyNote);


router.get("/eduallsinglequarterlynote/get/:STUDENTCODE", VerifyToken ,   GetsingleQuarterlyNote); 
router.get("/eduallsinglequarterlynotebyqrtsubcls/get/:QUARTER,:SUBJECT,:CLASS", VerifyToken ,   GetsingleQuarterlyNotebYQrtSub); 
router.get("/eduallsinglequarterlynotebyqrtsubstdqrttyp/get/:SUBJECT,:STUDENT,:QUARTER,:CLASS", VerifyToken ,   GetSingleQuarterlyNoteBySubStdQrtType) 
router.get("/eduallsinglequarterlynotebyqrtsubstdqrttypeclass/get/:SUBJECT,:STUDENT,:QUARTER,:CLASS", VerifyToken ,   GetSingleQuarterlyNoteBySubStdQrtTypeClass); 
router.get("/eduallsinglequarterlynotebysubcls/get/:SUBJECT,:CLASS", VerifyToken ,   GetsingleQuarterlyNotebYSubCls); 
router.put("/eduallquarterlynoteupdate/update/:ID", VerifyToken ,   QuarterlyNoteUpdate); 
router.put("/eduallquarterlynotedelete/delete/:ID", VerifyToken ,   QuarterlyNoteDelete); 
router.get("/eduallsinglequarterlynotebyid/get/:ID", VerifyToken ,   GetsingleQuarterlyNoteByID);
router.get("/eduallgetnotesbyclassandsubjects/get/:SUBJECT,:CLASS", VerifyToken ,    GetSingleClassScoreByNumber);



// --- ESCOLAS ---
router.get('/eduallinstitutes/get', VerifyToken, GetInstitutes);
router.post('/eduallinstituteregister/post', VerifyToken, RegisterInstitute);
router.get("/eduallsingleinstitute/get/:ID", VerifyToken,  GetSingleInstitute); 
router.put("/eduallinstituteupdate/update/:ID", VerifyToken, InstituteUpdate);

 
// ===========================
// ======== CLASSES ==========
// ===========================

// Notas por semestre e subclasses
router.get('/eduallsemesternotesbysubclasssm/get/', VerifyToken, GetsingleSemesterNotebYQrtSub);
router.get("/eduallsinglesemesternotebysemsubcls/get/:SEMESTER,:SUBJECT,:CLASS", VerifyToken,  GetsingleSemesterNotebYQrtSub); 
router.get("/eduallsinglesemesternotebysmtsubstdqrttypeclass/get/:SUBJECT,:STUDENT,:SEMESTER,:CLASS",  GetSingleSemesterNotebYSubStdQrtTypeClass);
router.get("/eduallgetsemesternotebyid/get/:ID", VerifyToken,  GetsingleSemesterNoteByID);
router.get("/eduallgetstudentsemesternotesbyclassandsemester/get/:STUDENT,:SEMESTER,:CLASS", VerifyToken,  GetsingleStudentSemesterNotebYCls);
router.get("/eduallstudent/all-subjects-notes/:student_id/:class_id/:semester", VerifyToken,  GetAllSubjectsNotesByStudent);
router.get("/eduall/notes/all-by-trimester/:semester", VerifyToken,  GetAllNotesByTrimester);
router.get("/eduallgetsinglestudentsemesternote/:STUDENTCODE",  VerifyToken,   GetsingleSemesterNote)
router.get("/eduallclasses/subjects/byclass/:classID", VerifyToken,  GetClassSubjectsByClassID); 

router.get("/eduallclasses/subjects/byclass2/:classID", VerifyToken,  GetClassSubjectsFromClassTableByClassID); 

 
router.post("/eduallregistersemesternotes/post/", VerifyToken, RegisterSemesterNote);
router.put("/eduallsemesternotesupdate/update/:ID", VerifyToken, SemesterNoteUpdate); 
router.put("/eduallsemesternotesdelete/delete/:ID", VerifyToken, SemesterNoteDelete);

// Notas dos exames por classe e matéria
router.get("/eduallgetstudentexamscorebyclassubject/:SUBJECT,:STUDENT,:CLASS", VerifyToken,  GetsingleStudentExamNotebYSubStCls);
router.post("/eduallstudentexamscoreregister/post", VerifyToken, RegisterStudentExamNotes);
router.put("/eduallstudentexamscoreupdate/update/:ID", VerifyToken, UpdateStudentExamNotes);
router.put("/eduallstudentexamscoredelete/delete/:ID", VerifyToken, DeleteStudentExamNotes);

  
// Notas em destaque por classe e matéria
router.get("/eduallgetstudentfeaturedscorebyclassubject/:SUBJECT,:STUDENT,:CLASS", VerifyToken,  GetsingleStudentFeaturedNotebYSubStCls);
router.get("/eduallgetstudentfeaturedscorebyclassubject/:SUBJECT,:STUDENT,:CLASS",VerifyToken,GetAllStudentFeaturedNotesByClassSubject);
 
// ── CRUD individual ───────────────────────────────────────────────────────
router.post("/eduallstudentfeaturedscoreregister/post",         VerifyToken, RegisterStudentFeaturedNotes);
router.put( "/eduallstudentfeaturedscoreupdate/update/:ID",      VerifyToken, UpdateStudentFeaturedNotes);
router.put( "/eduallstudentfeaturedscoredelete/delete/:ID",      VerifyToken, DeleteStudentFeaturedNotes);
 
// ── Bulk upsert ─────────────────────────────────────────────────────────── 
router.post("/eduallstudentfeaturedscores/bulk", VerifyToken, BulkUpsertStudentFeaturedNotes);

 
 



// ===========================
// ======== ESTUDANTES =======
// ===========================

// Presença dos estudantes
router.get("/eduallgetallstudentsattendance/get", VerifyToken, GetStudentAttendance);
router.get("/eduallgetstudentsattendancebyteacher/get/:ID", VerifyToken,  GetStudentAttendanceByTeacher);
router.get("/eduallgetstudentattendancebyteacherclassandsub/get/:ID", VerifyToken,  GetStudentAttendanceByTeacherAndClassSub);
router.get("/eduallgetsinglestudentattendance/get/:ID", VerifyToken,  GetSingleStudentAttendance);
router.get("/eduallgetallstudentattendance/get/:CODE,:CLASS", VerifyToken,  GetAllStudentAttendance);
router.get("/eduallgetstudentattendancebyclqrtsubjstcode/get/:CLASS,:SUBJECT,:STUDENT,:QRT", VerifyToken,  GetStudentAttendanceByClassSubStuQrt);

router.put("/eduallstudentattendancedelete/delete/:ID", VerifyToken, StudentAttendanceDelete);
router.put("/eduallstudentattendanceupdate/update/:ID", VerifyToken, StudentAttendanceUpdate);
router.post("/eduallstudentattendanceregister/post", VerifyToken, RegisterStudentAttendance);
router.get("/eduallcheckexistentstudentattendance/get/:CLASS,:SUBJECT,:STUDENT,:TIME,:DATE", VerifyToken,  CheckExistentSingleStudentAttendance);


// ===========================
// ======== PROFESSORES ======
// ===========================

// Horários dos professores
router.get("/eduallgetallteachertiming/get/:CODE", VerifyToken,  GetAllTeacherTiming);
router.get("/eduallgetsingleteachertiming/get/:ID,:CODE,:CLASS,:SUBJECT", VerifyToken,  GetSingleTeacherTiming);
router.get("/eduallgetteachertimingbyclasssub/get/:SUBJECT,:CLASS,:CODE,:ID/", VerifyToken,  GetTeacherTimingByClassSub);
router.put("/edualldeleteteachertiming/delete/:ID", VerifyToken, TeacherTimingDelete);
router.post("/eduallteachertimingregister/post", VerifyToken, RegisterTeacherTiming);


// ===========================
// ======== PONTOS (CTNAVL) ===
// ===========================

router.post("/eduallregisterctnavlpoint/post", VerifyToken, RegisterPoint);
router.get("/eduallgetctnavlpointsbysubclass/get/:ID", VerifyToken,  GetPointsBySubClass);
router.put("/eduallgetctnavlpointsbysubclass/delete/:ID", VerifyToken, PointDelete);
router.put("/eduallgetctnavlpointsbysubclass/update/:ID", VerifyToken, PointUpdate);
router.get("/eduallgetsinglectnavlpoints/get/:ID", VerifyToken,  GetSinglePoint);


// ===========================
// ======== TAREFAS E PROJETOS ==========
// ===========================

router.get("/eduallgetalltasksandprojects/get/", VerifyToken, GetAllTasksAndProjects);
router.get("/eduallgettasksandprojectsbycreator/get/:CODE", VerifyToken,  GetProjectsByCreator);
router.get("/eduallgetsingletaskandproject/get/:ID/", VerifyToken,  GetSingleTaskAndProject);
router.post("/eduallcreatenewtaskandproject/post/", VerifyToken, RegisterTaskAndProject);
router.put("/eduallsingletaskandproject/delete/:ID", VerifyToken, TaskAndProjectDelete);

router.get("/eduallgettaskandprojectmembers/get/:CODE", VerifyToken,  GetMembersByProject);
router.post("/eduallregistertaskandprojectmember/post", VerifyToken, RegisterTaskAndProjectMember);
router.put("/edualltaskandprojectdelete/delete/:ID", VerifyToken, TaskAndProjectMemberDelete);


// ===========================
// ======== LIÇÕES E SEÇÕES =======
// ===========================

router.get("/eduallgetlessonssectionbygroup/get/:CODE", VerifyToken,  GetLessonsSectionByGroup);
router.get("/eduallgetsinglelessonssection/get/:ID", VerifyToken,  GetSingleLessonSection);
router.post("/eduallcreatelessonsection/post/", VerifyToken, RegisterLessonSection);
router.put("/edualllessonsectionupdateposition/update/:ID", VerifyToken, LessonSectionUpdatePosition);
router.put("/edualllessonsectionupdate/update/:ID", VerifyToken, LessonSectionUpdate);
router.put("/edualllessonsectiondelete/delete/:ID", VerifyToken, LessonSectionDelete);
router.get("/edualllessonsectionbygroupcode/:GROUP", VerifyToken,  GetLessonsSectionBuyGroupCode);

router.get("/edualllessonsectionbycreator/get/", VerifyToken, GetLessonsSectionByCreator);

// Conteúdos das lições
router.get("/edualllessoncontent/tree/:CODE", VerifyToken,  GetFullLessonTree);
router.post("/edualllessoncontent/register", VerifyToken, RegisterLessonContent);
router.put("/edualllessoncontent/delete/:ID", VerifyToken, DeleteLessonContent);
router.put("/edualllessoncontent/done/:ID", VerifyToken, MarkLessonContentDone);
router.put("/edualllessoncontent/move/:ID", VerifyToken, MoveLessonContent);
router.put("/edualllessoncontent/reorder/:parent_type/:parent_code", VerifyToken, ReorderLessonContent);
router.post("/edualllessoncontent/upload/video", VerifyToken, (req, res) => UploadLessonVideo);
router.post("/edualllessoncontent/upload/poster", VerifyToken, (req, res) => UploadLessonVideoPoster);

const multer = require("multer");
const { setTenantCode, syncUploadSingleTable, syncDownloadSingleTable } = require("../Controllers/syncEngine");
const { GetDocuments, GetSingleDocument, RegisterDocumentsFromArray } = require("../Controllers/DocumentsCenter");
const { GenerateFrequencyTerm, GeneratePerformanceMap, GenerateCertificate, GenerateQualificationsStatement, GenerateIndividualBulletin, GenerateAnnualBulletin, GenerateMiniPautaBySubject, GenerateMiniPautaByClass, GenerateFinalPauta, GenerateFinalPautaExam, GenerateTeacherMiniPauta, GenerateClassGrades } = require("../Controllers/DocumentCenterGenerate");
const { RegisterLessonPlan, GetLessonPlans, GetAllLessonPlansAdmin, GetSingleLessonPlan, UpdateLessonPlan, UpdateSchoolNotes, DeleteLessonPlan } = require("../Controllers/Lessonplancontroller");
const { RegisterReferral, GetAllReferrals, GetSingleReferral, UpdateReferralStatus, DeleteReferral } = require("../Controllers/Referralcontroller");
const { SearchStudentsBalance, GetStudentBalanceLogs, GetStudentBalance, DepositStudentBalance, DeductStudentBalance } = require("../Controllers/StudenBalanceController");
const { uploadExpenses, UpdateExpenseStatus, GetExpenses, GetSingleExpense, GetExpensesSummary, RegisterExpense, UpdateExpense, DeleteExpense } = require("../Controllers/schoolExpenses");
const { GetEnrollmentTemplates, GetSingleEnrollmentTemplate, GetActiveTemplateByModel, RegisterEnrollmentTemplate, UpdateEnrollmentTemplate, DeleteEnrollmentTemplate } = require("../Controllers/Enrollmenttemplates");
const { GetAllCashOutflows, GetSingleCashOutflow, RegisterCashOutflow, UpdateCashOutflow, DeleteCashOutflow, GetCashOutflowReport } = require("../Controllers/Saidasdecaixa");
const { GetFrequenciaHistorico, GetAllResponsaveisByStudent, SearchResponsavel, RegistrarFrequencia, RegistrarResponsavelTemporario, GetFrequenciaGeral, GetStudentForPortaria, SearchStudent, uploadResponsavelPortaria, RegisterResponsavelPortaria } = require("../Controllers/ParentsPickup");
const { initFineCron, GetFineRules, CreateFineRule, UpdateFineRule, ToggleFineRule, DeleteFineRule, ConflictCheck, GetExclusions, AddExclusion, RemoveExclusion, GetFineLogs, GetFineLogsByStudent,   CalculateStudentFine, RunFineEngine, SendSMSToResponsibles, GetSMSCredits, GetClassDebtors, GetClassListForFines, CalculateStudentFineByRule } = require("../Controllers/FinesController");
const { RegisterAppManager, GetLibraryAccess, UpdateLibraryAccountType, GetLibraryUsers, EduallResetLibraryReaderPassword, EduallResetLibraryReaderPasswordByEmail } = require("../Controllers/AppManager");
const { GetAllBulletinHistory, GetBulletinHistoryById, RegisterBulletinHistory, UpdateBulletinHistory, DeleteBulletinHistory } = require("../Controllers/BulletinHistoryController");
const upload = multer({ storage: multer.memoryStorage() });
router.post("/edualllessoncontent/files/register", VerifyToken,  upload.array("files"),  RegisterLessonFiles);
router.put("/edualllessoncontent/update/:ID", VerifyToken,  upload.fields([
    { name: "video", maxCount: 1 },
    { name: "poster", maxCount: 1 },
    { name: "files", maxCount: 20 }
  ]), UpdateLessonContent);
router.get("/edualllessoncontent/get/:ID", VerifyToken, GetLessonContentById);


 
// ===========================
// ======== FUNCIONÁRIOS =======
// ===========================

router.get("/eduallgetallemployeesattendence/get/", VerifyToken, GetEmployeesAttendance);
router.get("/eduallgetemployeeattendencebycode/get/:CODE", VerifyToken,  GetEmployeeAttendanceBycode);
router.get("/eduallgetsingleemployeeattendence/get/:ID", VerifyToken,  GetSingleEmployeeAttendance);
router.post("/eduallregisteremployeeattendence/post/", VerifyToken, RegisterEmployeeAttendance);
router.put("/eduallemployeeattendencedelete/delete/:ID", VerifyToken, EmployeeAttendanceDelete);
router.put("/eduallemployeeattendenceupdate/update/:ID", VerifyToken, EmployeeAttendanceUpdate);


// ===========================
// ======== COMENTÁRIOS E REAÇÕES =======
// ===========================

router.get("/eduallgetlessonreviewsbylessonid/:CODE", VerifyToken,  GetLessonsReviewsByLesson);
router.get("/eduallgetCommentsDatabyidandtype/:ID,:TYPE", VerifyToken,  GeCommentsByContentIdAndType);
router.get("/eduallgetCommentsrepliesbyid/:ID", VerifyToken,  GeCommentsRepliesByCommentId);
router.get("/eduallgetCommentssubrepliesbyid/:ID", VerifyToken,  GeCommentsSubRepliesByReplietId);
router.get("/eduallgetcommentreactionbyidandtype/:ID,:TYPE", VerifyToken,  GeCommentReactionsByReplietIdAndType);


// ===== TRANSPORTE ===== 

// Rotas de transporte - rotas
router.post("/edualltransportrouteregister/post/", VerifyToken, RegisterTransportRoute);
router.get("/edualltransportroutesget/get/", VerifyToken, GetTransportRoutes);
router.get("/edualltransportsinglerouteget/get/:ID", VerifyToken,  GetsingleTransportRoute);
router.put("/edualltransportroutedelete/delete/:ID", VerifyToken, TransportRouteDelete);
router.put("/edualltransportrouteupdate/update/:ID", VerifyToken, TransportRouteUpdate);

// Rotas de transporte - passageiros
router.post("/edualltransportpassengerregister/post/", VerifyToken, RegisterTransportPassenger);
router.get("/edualltransportpassengerget/get/", VerifyToken, GetTransportPassengers);
router.get("/edualltransportsinglepassengerget/get/:ID", VerifyToken,  GetTransportsinglePassenger);
router.put("/edualltransportpassengerdelete/delete/:ID", VerifyToken, TransportPassengerDelete);
router.put("/edualltransportpassengerupdate/update/:ID", VerifyToken, TransportPassengerUpdate);
router.get("/eduallgetpassengerbystudentcode/:ID", VerifyToken,  GetTransportsinglePassengerByStudentId);

// Rotas de transporte - veículos
router.post("/edualltransportvehicleregister/post/", VerifyToken, uploadTransportVehiclePicture, RegisterTransportVehicle);
router.get("/edualltransportvehicleget/get/", VerifyToken, GetTransportVehicles);
router.get("/edualltransportsinglevehicleget/get/:ID", VerifyToken,  GetSingleTransportVehicle);
router.put("/edualltransportvehicledelete/delete/:ID", VerifyToken, TransportVehicleDelete);
router.put("/edualltransportvehicleupdate/update/:ID", VerifyToken, uploadTransportVehiclePicture, TransportVehicleUpdate);

// Rotas de transporte - manutenção
router.post("/edualltransportmaintenanceeregister/post/", VerifyToken, RegisterTransportMaintenance);
router.get("/edualltransportmaintenanceget/get/", VerifyToken, GetTransportMaintenances);
router.get("/edualltransportsinglemaintenanceget/get/:ID", VerifyToken,  GetsingleTransportMaintenance);
router.put("/edualltransportmaintenancedelete/delete/:ID", VerifyToken, TransportMaintenanceDelete);
router.put("/edualltransportmainenanceupdate/update/:ID", VerifyToken, TransportMaintenanceUpdate);

// Rotas de transporte - paradas
router.post("/edualltransportstopsregister/post/", VerifyToken, RegisterTransportStop);
router.get("/edualltransportstopsget/get/", VerifyToken, GetTransportStops);
router.get("/edualltransportsinglestopget/get/:ID", VerifyToken,  GetsingleTransportStop);
router.put("/edualltransportstopsdelete/delete/:ID", VerifyToken, TransportStopDelete);
router.put("/edualltransportstopupdate/update/:ID", VerifyToken, TransportStopUpdate);

// Rotas de transporte - motoristas
router.post("/edualltransportdriverregister/post/", VerifyToken, uploadTransportDriverPicture, RegisterTransportDriver);
router.get("/edualltransportdriversget/get/", VerifyToken, GetTransportDrivers);
router.get("/edualltransportsingledriverget/get/:ID", VerifyToken,  GetSingleTransportDriver);
router.put("/edualltransportsdriverdelete/delete/:ID", VerifyToken, TransportDriverDelete);
router.put("/edualltransportdriverupdate/update/:ID", VerifyToken, uploadTransportDriverPicture, TransportDriverUpdate);



// conteudo digital livros
router.post("/edualldigitalcontentregister/post/", VerifyToken, uploadDigitalContentFile, RegisterDigitalContent);
router.get("/edualldigitalcontentsget/get/",  VerifyToken, GetDigitalContents);
router.get("/eduallsingledigitalcontentget/get/:ID",  VerifyToken, GetSingleDigitalContent);
router.put("/edualldigitalcontentdelete/delete/:ID", VerifyToken, DigitalContentDelete);
router.put("/edualldigitalcontentupdate/update/:ID", VerifyToken, uploadDigitalContentFile, DigitalContentUpdate);


// ===== MULTAS E SERVIÇOS =====

// Consultas e alterações de multas
router.get("/eduallgetsinglefinebyservice/get/:SERVICE", VerifyToken,  GetSingleFineByService);
router.get("/eduallgetservicefines/get/", VerifyToken, GetFines);
router.put("/eduallfineupdate/update/:ID", VerifyToken, FineUpdate);
router.put("/eduallfinedelete/delete/:ID", VerifyToken, FineDelete);
router.get("/eduallgetsinglefine/get/:ID", VerifyToken,  GetSingleFine);
router.post("/eduallfineregister/post", VerifyToken, RegisterFine);
 


// ===== REQUISIÇÕES =====

router.post("/eduallregisterrequest/post/", VerifyToken, RegisterRequest);
router.get("/eduallgetrequests/get", VerifyToken, GetRequests);
router.put("/eduallrequestupdate/update/:ID", VerifyToken, RequestUpdate);
router.get("/eduallgetsinglerequest/get/:ID", VerifyToken,  GetsingleRequest);
router.put("/eduallrequestdelete/delete/:ID", VerifyToken, RequestDelete);


// ===== ÁLBUNS E MÚSICA =====

router.post("/edualladsregister/post/:ID", VerifyToken, RegisteraDS);
router.get("/eduallgetsingeralbums/", VerifyToken, GetSingerAlbums);


// ===== FACULDADES =====

router.get("/eduallgetfaculties/get/", VerifyToken, GetFaculties);
router.get("/eduallgetsinglefaculty/get/:ID", VerifyToken,  GetSingleFaculty);
router.post("/eduallregisterfaculty/post/", VerifyToken, RegisterFaculty);
router.put("/eduallfacultydelete/delete/:ID", VerifyToken, FacultyDelete);
router.put("/eduallfacultyupdate/update/:ID", VerifyToken, FacultyUpdate);



router.put("/eduallservicepaymentdeleteinvoice/delete/:ID", VerifyToken, DeleteServiceWithFees); 



// ═════════════════════════════════════════════════════════════════════════
// MULTAS — CRUD e operações
// ═════════════════════════════════════════════════════════════════════════
router.get("/eduallibraryfines/get", VerifyToken, GetFinesLIB);
router.get("/eduallibraryfines/:id", VerifyToken, GetFineById);
router.post("/eduallibraryfines/post", VerifyToken, CreateFine);
router.put("/eduallibraryfines/pay/:id", VerifyToken, PayFine);
router.put("/eduallibraryfines/exempt/:id", VerifyToken, ExemptFine);
router.put("/eduallibraryfines/delete/:id", VerifyToken, DeleteFine);
router.get("/eduallibraryfines/kpis", VerifyToken, GetFinesKpis);
router.get("/eduallibraryfines/dashboard", VerifyToken, GetFinesDashboard); 
router.post("/eduallibraryfines/preview", VerifyToken, PreviewFineForLoan); 
router.get("/eduallibraryfinerules/get", VerifyToken, GetLibraryFineRules);
router.post("/eduallibraryfinerules/post", VerifyToken, CreateLibraryFineRule);
router.put("/eduallibraryfinerules/update/:id", VerifyToken, UpdateLibraryFineRule);
router.put("/eduallibraryfinerules/toggle/:id", VerifyToken, ToggleLibraryFineRule);
router.put("/eduallibraryfinerules/delete/:id", VerifyToken, DeleteLibraryFineRule); 
router.get("/eduallibraryfineexclusions/get/:ruleId", VerifyToken, GetLibraryFineExclusions);
router.post("/eduallibraryfineexclusions/post", VerifyToken, AddLibraryFineExclusion);
router.put("/eduallibraryfineexclusions/delete/:id", VerifyToken, RemoveLibraryFineExclusion); 
router.get("/eduallibraryfines/users/search", VerifyToken, SearchUsersForFines);
router.get("/eduallibraryfines/loans/search", VerifyToken, SearchLoansForFines);
router.put("/eduallibraryfines/engine/run", VerifyToken, RunLibraryFineEngine);





// ===== INSTITUTOS =====

router.get("/eduallgetsingleinstitute/get/:ID", VerifyToken,  GetSingleInstitute);
router.put("/eduallupdateinstitute/update/", VerifyToken, uploadInstituteLogo, InstituteUpdate);
router.get("/eduallgetsingleinstitutebycode/get/:CODE", VerifyToken,  GetSingleInstituteByCode);
router.get("/eduallgetcurentuserinstitute/get/", VerifyToken, GetCurrentInstituteByCode);
router.get("/eduallgetallinstitutes/get", VerifyToken, GetInstitutes);

// Licença dos institutos
router.get("/eduallgetinstitutelicencestatus/get", VerifyToken, GetCurentLicence);
router.post("/eduallupdatecurrentinstitutecode/post/:CODE", VerifyToken, UpdateCurrentUserInstitute);


// ===== CONTAS DE ACESSO AO PORTAL DO PROFESSOR =====
 
// ─── Rotas existentes (inalteradas) ───────────────────────────────────────────
router.get("/eduallgetsingleuserinstitutes/get/:CODE",   VerifyToken, GetSingleUserInstitutes);
router.get("/eduallgetalluserinstitutes/get",            VerifyToken, GetInstituteAccounts);
router.post("/eduallregisteruserinstitutes/post",        VerifyToken, RegisterInstituteAccount);
router.get("/eduallgetsingleuserinstitutes/getx/:ID",   VerifyToken, GetSingleInstituteAccount);
router.put("/eduallupdateuserinstitutes/update/:ID",    VerifyToken, UpdateInstituteAccount);
router.put("/edualldeleteuserinstitutes/delete/:ID",    VerifyToken, DeleteInstituteAccount);

// ─── Contas unificadas (dashboard + apps) ─────────────────────────────────────
router.post("/eduallregisterunifiedaccount/post",               VerifyToken, UnifiedAccountRegister);
router.post("/eduallregistermanager/post",               VerifyToken, RegisterAppManager);
router.get("/eduallgetallappaccounts/get",                      VerifyToken, GetAppAccounts);
router.get("/eduallgetalldashboardaccounts/get",                VerifyToken, GetDashboardAccounts);
router.put("/edualldeleteappaccount/delete/:id",                VerifyToken, DeleteAppAccount);
router.put("/eduallupdatedashboardaccess/update/:id",           VerifyToken, UpdateDashboardAccess);
router.get("/eduallgetavailableapps/get",                       VerifyToken, GetAvailableApps);


router.get("/eduall_library_access/get", VerifyToken, GetLibraryAccounts); 
router.put("/eduall_library_access/:id", VerifyToken,  UpdateLibraryAccess); 
router.delete("/eduall_library_access/:id",VerifyToken,  DeleteLibraryAccess);
  
 
// ─── Licenças de apps da instituição ─────────────────────────────────────────
router.get("/eduallgetinstituteapps/get",                       VerifyToken, GetInstituteApps);
router.post("/eduallregisterinstituteapp/post",                 VerifyToken, RegisterInstituteApp);
router.put("/edualldeleteinstituteapp/delete/:id",              VerifyToken, DeleteInstituteApp);
 

// ───reservas de livros───────────────────────────────────────── 
router.get('/edualllibraryreservationsmy/get',                  VerifyToken, GetMyReservations);   
router.post('/edualllibraryreservationssimple/post',            VerifyToken, RegisterReservationSimple); 
 
// ─── ROTAS ADMIN ──────────────────────────────────────────────
router.get('/edualllibraryreservations/get',                    VerifyToken, GetReservations);        
router.get('/edualllibraryreservationskpis/get',                VerifyToken, GetReservationsKpis);   
router.get('/edualllibraryreservationschart/get',               VerifyToken, GetReservationsChart);    
router.get('/edualllibraryreservationsbooksavailable/get',      VerifyToken, GetAvailableBooksForReservation);
router.get('/edualllibraryreservationshistory/get/:USER_ID',    VerifyToken, GetReservationHistoryByUser);
router.post('/edualllibraryreservationsregister/post',          VerifyToken, RegisterReservation);    
router.put('/edualllibraryreservationsconfirm/update/:ID',      VerifyToken, ConfirmReservation);
router.put('/edualllibraryreservationscancel/update/:ID',       VerifyToken, CancelReservation);
router.put('/edualllibraryreservationsdelete/delete/:ID',       VerifyToken, DeleteReservation);
 
 


///////////////////////
// ===== CLASSES =====
///////////////////////

// Rotas GET sem parâmetros -> CacheLimitTime_one
router.get("/eduallgetsingleuserchilds/get", VerifyToken, GetSingleUserChilds);
router.get("/api/library/users", VerifyToken, GetLibraryUsers);
router.post("/api/libraryAccess/:userid", VerifyToken, UpdateLibraryAccountType);


router.put('/eduall/library/reader/:accessId/reset-password',VerifyToken,EduallResetLibraryReaderPassword);
router.put('/eduall/library/reader/email/:email/reset-password',VerifyToken, EduallResetLibraryReaderPasswordByEmail);
 

// Rotas GET com parâmetros -> CacheLimitTime_two
router.get("/eduallchecksingleuserchild/get/:USERCODE,:STUDENTCODE", VerifyToken,  ChewckSingleUserChilds);
router.get("/eduallgetuserchilds/get/:ID", VerifyToken,  GetUserChilds);

// Outros métodos (POST, PUT) sem cache
router.post("/edualluserchildregister/post/", VerifyToken, RegisterUserChilds);
router.get("/eduallgetuserparentsacccountsbyinstitute/get", VerifyToken, GetParentsUserChildsByInstitute);
router.put("/edualluserchildaccountdelete/delete/:ID", VerifyToken, UserChildDelete);

//////////////////////////
// ===== ESTUDANTES =====
//////////////////////////

// POST e PUT sem cache
router.post("/eduallstudentexamcalendarregister/post", VerifyToken, RegisterStudentExamCalendar);

// GETs com e sem parâmetros
router.get("/eduallstudentexamcalendarget/get/", VerifyToken, GetExamsCalendar);
router.get("/eduallstudentexamcalendargetsingle/get/:ID", VerifyToken,  GetSingleExamCalendar);
router.get("/eduallstudentexamcalendargetbyclass/get/:CLASS", VerifyToken,  GetExamsCalendarByClass);

router.put("/eduallstudentexamcalendarupdate/update/:ID", VerifyToken, UpdateStudentExamCalendar);
router.put("/eduallstudentexamcalendardelete/delete/:ID", VerifyToken, DeleteStudentExamCalendar);

///////////////////////////
// ===== CONEXÕES =====
///////////////////////////

router.get("/eduallgetcurrentuserconnections/get", VerifyToken, GetCurrentUserConnections);
router.post("/eduallcreatechatmessage/post/", VerifyToken, CreateChatMessage);
router.get("/eduallgetchatmessagesbycontact/get/:CODE", VerifyToken,  GetChatMessagesByContact);

//////////////////////////////////////
// ===== USER STUDENT ACCOUNTS =====
//////////////////////////////////////

router.post("/edualluserstudentaccountregister/post", VerifyToken, RegisterStudentUserAccount);

router.get("/eduallsingleuserstudentaccountsget/get/:ID", VerifyToken,  GetSingleUserStudentAccounts);
router.get("/eduallsingleuserstudentaccountsgetbystudent/get/:ID", VerifyToken,  GetSingleUserStudentAccountsByStudent);
router.get("/eduallsingleuserstudentaccountsgetbystudent/workspaces/:ID", VerifyToken,  GetSingleUserStudentAccountsByStudentWorkspaces);
router.get("/eduallgetuserstudentsaccounts/get", VerifyToken, GetUsersStudentsAccountsByInstitute);

router.put("/edualluserstudentsaccountdelete/delete/:ID", VerifyToken, UserStudentAccountDelete);

/////////////////////////////////
// ===== STUDENT BEHAVIOR =====
/////////////////////////////////

router.post("/eduallstudentbehaviorregister/post/", VerifyToken, RegisterStudentBehavior);
router.get("/eduallgetstudentbehaviorbystudentcode/get/:ID", VerifyToken,  GetAllStudentBehaviorByStudentCode);

/////////////////////////////
// ===== PUBLICATIONS =====
/////////////////////////////

router.post("/eduallpublicationregister/post", VerifyToken, RegisterPublication);

router.get("/eduallgetpostforcurrentuser/get", VerifyToken, GetPostsForCurrentUser);
router.get("/eduallgetcurrentuiserposts/get", VerifyToken, GetCurrentUserPosts);
router.get("/eduallgetpostsbyusercontactsandfollowers/get", GetUserPostsByContacts);

//////////////////////////
// ===== EMAILS/SMS =====
//////////////////////////

router.post("/eduallsendemail/post/", VerifyToken, SendEmailMessage);
router.post("/eduallchangeserverinternetstatus/post", VerifyToken, ChangeServerNetworkStatus);
router.post("/addalbum", VerifyToken, addAlbum);

///////////////////////////////
// ===== FOLLOW INSTITUTE =====
///////////////////////////////

router.post("/eduallstartfollowinginstitute/post", VerifyToken, FollowInstitute);
router.get("/eduallcheckiffollowinginstitute/get/:CODE", VerifyToken,  CheckIfFollowingInstitute);

router.get("/eduallgetinstitutefollowers/get/:CODE", VerifyToken,  GetSingleInstituteFollowers);

router.get("/eduallinstitutessearch/search/:TEXT", VerifyToken,  EduallSearchInstitutes);

////////////////////////////////
// ===== USER CONTACTS =====
////////////////////////////////

router.post("/eduallmakeusercontactrequest/post", VerifyToken, MakeUserContactRequest);
router.get("/eduallcheckifuserisacontact/get/:CODE", VerifyToken,  CheckUserContactRequest);
router.post("/eduallprofilepageregistervisitor/post", VerifyToken, RegisterProfilePageVisitor);

/////////////////////////////////////
// ===== CP PAGES (Conteúdo) =====
/////////////////////////////////////

router.get("/eduallgetsinglecppagebycd/get/:CODE",  GetSingleCpPageByCode);

////////////////////////////////////////////
// ===== ACCOUNTS PAYABLE & RECEIVABLE =====
////////////////////////////////////////////

router.get("/eduallgetaccounts_payable_and_receivable/get/", VerifyToken, GetAccountsPayableAndReceivable);
router.get("/eduallgetsingleaccount_payable_and_receivable/get/:ID", VerifyToken,  GetSingleAccountPayableAndReceivable);
router.post("/eduallregisteraccount_payable_and_receivable/post/", VerifyToken, RegisterAccountPayableAndReceivable);
router.put("/eduallaccount_payable_and_receivabledelete/delete/:ID", VerifyToken, DeleteAccountPayableAndReceivable);
router.put("/eduallaccount_payable_and_receivableupdate/update/:ID", VerifyToken, UpdateAccountPayableAndReceivable);

///////////////////////////////////////
// ===== PRODUCT CATEGORY =====
///////////////////////////////////////

router.get("/eduallgetproduct_category/get/", VerifyToken, GetProductCategories);
router.get("/eduallgetsingleproduct_category/get/:ID", VerifyToken,  GetSingleProductCategory);
router.post("/eduallregisterproduct_category/post/", VerifyToken, RegisterProductCategory);
router.put("/eduallproduct_categorydelete/delete/:ID", VerifyToken, DeleteProductCategory);
router.put("/eduallproduct_categoryupdate/update/:ID", VerifyToken, UpdateProductCategory);

///////////////////////////////////////
// ===== ADMISSION STUDENTS =====
///////////////////////////////////////

router.get("/edualladmissionstudents/get/", VerifyToken, GetAdmissionStudents);
router.post("/eduallregisteradmissionstudent/post/", VerifyToken, RegisterAdmissionStudent);
router.get("/eduallsingleadmissionstudent/get/:ID", VerifyToken,  GetSingleAdmissionStudent);
router.put("/edualladmissionstudentdelete/delete/:ID", VerifyToken, DeleteAdmissionStudent);
router.put("/edualladmissionstudentupdate/update/:ID", VerifyToken, UpdateAdmissionStudent);

///////////////////////////////////////
// ===== ADMISSION EXAMS =====
///////////////////////////////////////

router.get("/edualladmissionexams/get/", VerifyToken, GetAdmissionExams);
router.post("/eduallregisteradmissionexam/post/", VerifyToken, RegisterAdmissionExam);
router.get("/eduallsingleadmissionexam/get/:ID", VerifyToken,  GetSingleAdmissionExam);
router.put("/edualladmissionexamdelete/delete/:ID", VerifyToken, DeleteAdmissionExam);
router.put("/edualladmissionexamupdate/update/:ID", VerifyToken, UpdateAdmissionExam);

///////////////////////////////////////
// ===== ADMISSION EXAM SUBJECTS =====
///////////////////////////////////////

router.get("/edualladmissionexamsubjects/get/", VerifyToken, GetAdmissionExamSubjects);
router.get("/edualladmissionexamsubjectsbyexam/get/:CODE", VerifyToken,  GetAdmissionExamSubjectsByExam);
router.post("/eduallregisteradmissionexamsubject/post/", VerifyToken, RegisterAdmissionExamSubject);
router.put("/edualladmissionexamsubjectdelete/delete/:ID", VerifyToken, DeleteAdmissionExamSubject);

///////////////////////////////////////
// ===== ADMISSION RESULTS =====
///////////////////////////////////////

router.get("/edualladmissionresults/get/", VerifyToken, GetAdmissionResults);
router.post("/eduallregisteradmissionresult/post/", VerifyToken, RegisterAdmissionResult);
router.get("/eduallsingleadmissionresult/get/:ID", VerifyToken,  GetSingleAdmissionResult);
router.put("/edualladmissionresultdelete/delete/:ID", VerifyToken, DeleteAdmissionResult);


// ============== BOletim de notas =====
router.get('/eduall-bulletin-history/get', VerifyToken, GetAllBulletinHistory);
router.get('/eduall-bulletin-history/get/:ID', VerifyToken, GetBulletinHistoryById);
router.post('/eduall-bulletin-history/post', VerifyToken, RegisterBulletinHistory);
router.put('/eduall-bulletin-history/update/:ID', VerifyToken, UpdateBulletinHistory);
router.put('/eduall-bulletin-history/delete/:ID', VerifyToken, DeleteBulletinHistory);

//////////////////////////
// ===== SMS & EMAIL =====
////////////////////////// 


router.get("/eduallgetsmscredits/get/", VerifyToken, GetCreditsmsInformations);
router.get("/eduallgetallsentsms/get/", VerifyToken, GetAllSentSmS);
router.post("/eduallsendsmsmessage/post/", VerifyToken, SendSms);
router.post("/eduallresendsmsmessage/post/:ID", VerifyToken, ResendSms);
router.post("/eduallsendemailmessage/post/", VerifyToken, SendEmailToContacts);
router.get("/eduallgetallsentemails/get/", VerifyToken, GetAllSentEmails);

//////////////////////////
// ===== SALES =====
//////////////////////////

router.get("/eduallgetallproductsales/get/", VerifyToken, GetProductSales);
router.post("/eduallregisterproductssales/post/", VerifyToken, RegisterSale);
router.get("/eduallgetsinglesale/get/:ID", VerifyToken,  GetSingleSale);
router.put("/edualldeletesale/delete/:ID", VerifyToken, DeleteSale);

////////////////////////////
// ===== INVOICE =====
////////////////////////////

router.post("/eduallinvoicecoderegsiterandreturn/post/", VerifyToken, InvoiceController);
router.get('/eduallgenerateSAFT/create', VerifyToken, generateSAFT);

//////////////////////////
// ===== MANAGER =====
//////////////////////////

router.post("/eduall_register_newcustomer/register", RegisterInstitute);
router.get("/eduall_mn_getallinstitutes/get", GetAllRegisteredInstitutes);
router.get("/eduall_mn_getstatebycountry/get/:ID",  GetStatesByCountry);

//////////////////////
// ===== AUDITORY =====
//////////////////////
 
router.get("/eduallgetcurrentinstituteauditory/get", VerifyToken, GetAllAuditActionsByInstitute); 

router.get("/eduallinvoicedoc/:id/pdf",  VerifyToken, VENUDS_GetInvoicePdf); 
router.get("/vendus-saft/:year/:month", VerifyToken, VENDUS_GetSAFTFile); 
router.post("/eduallcreateinvoice", VerifyToken, handleCreateInvoice); 
router.get("/vendus-config", VerifyToken, handleGetConfig);
router.put("/vendus-config", VerifyToken, handleSaveConfig); 
router.get   ("/vendus-payment-methods", VerifyToken,    handleGetPaymentMethods);
router.post  ("/vendus-payment-methods",   VerifyToken,  handleSavePaymentMethod);
router.delete("/vendus-payment-methods/:id", VerifyToken, handleDeletePaymentMethod);

//////////////////////
// ===== PARENTS & KIDS =====
//////////////////////

router.post("/eduallparentkids/register", VerifyToken, RegisterParentKid);
router.get("/eduallparentkidsstudents/get/:ID", VerifyToken,  GetParentKids);
router.get("/eduallparentkidsparents/get/:ID", VerifyToken,  GetKidsParents);
router.put("/eduallparentkids/delete/:ID", VerifyToken, ParentkidDelete);






//////////////////////
// ===== PARENTS & KIDS =====
//////////////////////

router.post("/eduallparentkids/register", VerifyToken, RegisterParentKid);
router.get("/eduallparentkidsstudents/get/:ID", VerifyToken,  GetParentKids);
router.get("/eduallparentkidsparents/get/:ID", VerifyToken,  GetKidsParents);
router.put("/eduallparentkids/delete/:ID", VerifyToken, ParentkidDelete);






//////////////////////
// ===== PARENTS & KIDS =====
//////////////////////

router.post("/eduallregisterlessonplan", VerifyToken, RegisterLessonPlan);
router.get("/eduallgetlessonplans/:classId/:subjectId", VerifyToken,  GetLessonPlans);
router.get("/eduallgetalllessonplansadmin", VerifyToken,  GetAllLessonPlansAdmin);
router.get("/eduallgetsinglelessonplan/:ID", VerifyToken, GetSingleLessonPlan);
router.put("/eduallupdatelessonplan/:ID", VerifyToken, UpdateLessonPlan);
router.put("/eduallupdateschoolnotes/:ID", VerifyToken, UpdateSchoolNotes);
router.delete("/edualldeletelessonplan/:ID ", VerifyToken, DeleteLessonPlan);




 


//////////////////////
// ===== GEMINI IA =====
//////////////////////

router.post("/eduallgeminiiarequest/post", VerifyToken, GeminiIA);
router.get("/eduallgeminiallconversations", VerifyToken, GetIAConversations);

///////////////////////////
// ===== PEDAGOGY =====
///////////////////////////
 
router.put("/eduallpedagogyrestriction/update", VerifyToken, UpdateQuarterlyNoteRestriction);
router.get("/eduallgetquarterpermittions/get", VerifyToken, GetQuarterlyNotesPermissions);
router.get("/eduallquarterlyminipauta/:class/:quarter/:student?",  VerifyToken, GetQuarterlyMiniPautaFullData); 
router.get("/eduallstudentmtby3quarters/get/:class/:student", VerifyToken, GetStudentMTAll3Quarters);
router.put("/eduallsinglequarterlynotedelete/delete/:ID", VerifyToken, QuarterlyNoteDelete);
router.get("/pauta/final/mini/:class", VerifyToken, GetFinalMiniPautaFullData);
router.get("/eduall-final-mini-pauta-exam-resource/:class", VerifyToken, GetFinalMiniPautaExamsAndResourceFullData);
router.get("/pauta/minipauta-exame-disciplina/:class", VerifyToken, GetMiniPautaClasseExameBySubject);
router.get("/eduallgetalllexamclasses/", VerifyToken, GetClassOfExams);

//  

//GET /pauta/final/mini/:class/:student
//eduallsinglequarterlynotedelete/delete eduallsinglequarterlynotedelete/delete



///////////////////////////
// ===== ERP =====
///////////////////////////

// Salas
router.post('/api/classrooms/check', VerifyToken, ERP.ClassroomsCheck);
router.post('/api/classrooms/insert', VerifyToken, ERP.ClassroomsInsert);

// Estudantes
router.post('/api/students/check', VerifyToken, ERP.StudentsCheck);
router.post('/api/students/insert', VerifyToken, ERP.StudentsInsert);

// Níveis académicos
router.post('/api/academic-level/check', VerifyToken, ERP.AcademicLevelCheck);
router.post('/api/academic-level/insert', VerifyToken, ERP.AcademicLevelInsert);

// Anos académicos
router.post('/api/academic-year/check', VerifyToken, ERP.AcademicYearCheck);
router.post('/api/academic-year/insert', VerifyToken, ERP.AcademicYearInsert);

// Contas a pagar/receber
router.post('/api/accounts/check', VerifyToken, ERP.AccountsCheck);
router.post('/api/accounts/insert', VerifyToken, ERP.AccountsInsert);

// Ciclos
router.post('/api/cicles/check', VerifyToken, ERP.CiclesCheck);
router.post('/api/cicles/insert', VerifyToken, ERP.CiclesInsert);

// Turmas
router.post('/api/classes/check', VerifyToken, ERP.ClassesCheck);
router.post('/api/classes/insert', VerifyToken, ERP.ClassesInsert);

// Funcionários
router.post('/api/employees/check', VerifyToken, ERP.EmployeesCheck);
router.post('/api/employees/insert', VerifyToken, ERP.EmployeesInsert);

// Autores
router.post('/api/library/authors/check', VerifyToken, ERP.AuthorsCheck);
router.post('/api/library/authors/insert', VerifyToken, ERP.AuthorsInsert);

// Livros
router.post('/api/library/books/check', VerifyToken, ERP.BooksCheck);
router.post('/api/library/books/insert', VerifyToken, ERP.BooksInsert);

// Categorias de Livros
router.post('/api/library/categories/check', VerifyToken, ERP.BookCategoriesCheck);
router.post('/api/library/categories/insert', VerifyToken, ERP.BookCategoriesInsert);

// Contactos
router.post('/api/contacts/check', VerifyToken, ERP.ContactsCheck);
router.post('/api/contacts/insert', VerifyToken, ERP.ContactsInsert);

// Cursos
router.post('/api/courses/check', VerifyToken, ERP.CoursesCheck);
router.post('/api/courses/insert', VerifyToken, ERP.CoursesInsert);

// Produtos
router.post('/api/products/check', VerifyToken, ERP.ProductsCheck);
router.post('/api/products/insert', VerifyToken, ERP.ProductsInsert);

// Fornecedores
router.post('/api/providers/check', VerifyToken, ERP.ProvidersCheck);
router.post('/api/providers/insert', VerifyToken, ERP.ProvidersInsert);

// Editores
router.post('/api/library/publishers/check', VerifyToken, ERP.PublishersCheck);
router.post('/api/library/publishers/insert', VerifyToken, ERP.PublishersInsert);

// Prateleiras
router.post('/api/library/racks/check', VerifyToken, ERP.RacksCheck);
router.post('/api/library/racks/insert', VerifyToken, ERP.RacksInsert);

// Notas trimestrais
router.post('/api/grades/quarterly/check', VerifyToken, ERP.QuarterlyNotesCheck);
router.post('/api/grades/quarterly/insert', VerifyToken, ERP.QuarterlyNotesInsert);

// Notas semestrais
router.post('/api/grades/semester/check', VerifyToken, ERP.SemesterNotesCheck);
router.post('/api/grades/semester/insert', VerifyToken, ERP.SemesterNotesInsert);

// Serviços
router.post('/api/services/check', VerifyToken, ERP.ServicesCheck);
router.post('/api/services/insert', VerifyToken, ERP.ServicesInsert);

// Notas de exame
router.post('/api/exams/notes/check', VerifyToken, ERP.ExamNotesCheck);
router.post('/api/exams/notes/insert', VerifyToken, ERP.ExamNotesInsert);

// Disciplinas
router.post('/api/subjects/check', VerifyToken, ERP.SubjectsCheck);
router.post('/api/subjects/insert', VerifyToken, ERP.SubjectsInsert);

// Horários
router.post('/api/timings/check', VerifyToken, ERP.TimingsCheck);
router.post('/api/timings/insert', VerifyToken, ERP.TimingsInsert);


router.get('/api/libraryAccess',    VerifyToken, GetLibraryAccess);
router.put('/api/library-account-type/:accessId', VerifyToken, UpdateLibraryAccountType);




// templates de matriculas
router.get(   "/eduall-enrollment-templates/get",             VerifyToken, GetEnrollmentTemplates);
router.get(   "/eduall-enrollment-templates/get/:ID",         VerifyToken, GetSingleEnrollmentTemplate);
router.get(   "/eduall-enrollment-templates/active/:MODEL",   VerifyToken, GetActiveTemplateByModel);
router.post(  "/eduall-enrollment-templates/post",            VerifyToken, RegisterEnrollmentTemplate);
router.put(   "/eduall-enrollment-templates/update/:ID",      VerifyToken, UpdateEnrollmentTemplate);
router.delete("/eduall-enrollment-templates/delete/:ID",      VerifyToken, DeleteEnrollmentTemplate);

/////////////////////////
// ===== centro de documentos =====
/////////////////////////

 
router.get("/edualldocumentscentergetall/get/:ID", VerifyToken,  GetDocuments);
router.get("/eduallgetsingledocumentcenter/get/:ID", VerifyToken,  GetSingleDocument);
 

router.post("/eduallgetfrequencyterm/get/", VerifyToken, GenerateFrequencyTerm); 
router.post("/eduallgetperformancemap/get/",VerifyToken,GeneratePerformanceMap); 
router.post("/eduallgetcertificate/get/",VerifyToken,GenerateCertificate); 
router.post("/eduallgetqualificationsstatement/get/", VerifyToken,GenerateQualificationsStatement);
router.post("/eduallreports/class-grades", VerifyToken, GenerateClassGrades);
  

 
router.get('/eduallstudentbalancesearch',  VerifyToken, SearchStudentsBalance);
router.get('/eduallstudentbalancelogs/:studentId', VerifyToken, GetStudentBalanceLogs);
router.get('/eduallstudentbalance/:studentId',VerifyToken, GetStudentBalance);
router.post('/eduallstudentbalancedeposit',VerifyToken,  DepositStudentBalance);
router.post('/eduallstudentbalancededuct',VerifyToken, DeductStudentBalance);
 

 
router.post("/eduallreferralregister/post", VerifyToken, RegisterReferral);
router.get( "/eduallreferrallist/get", VerifyToken, GetAllReferrals);
router.get( "/eduallreferralsingle/get/:ID", VerifyToken, GetSingleReferral);
router.put( "/eduallreferralstatus/update/:ID", VerifyToken, UpdateReferralStatus);
router.put( "/eduallreferraldelete/delete/:ID", VerifyToken, DeleteReferral);



 
 
// ─── Listagem e resumo  de despesas ────────────────────────────────────────────────────────
router.get( "/eduallexpenseslist/get",           VerifyToken, GetExpenses);
router.get( "/eduallexpensessingle/get/:ID",     VerifyToken, GetSingleExpense);
router.get( "/eduallexpensessummary/get",        VerifyToken, GetExpensesSummary); 
router.post("/eduallexpensesregister/post",      VerifyToken, uploadExpenses.single("expense_receipt"), RegisterExpense);
router.put( "/eduallexpensesupdate/update/:ID",  VerifyToken, uploadExpenses.single("expense_receipt"), UpdateExpense);
router.put( "/eduallexpensesstatus/update/:ID",  VerifyToken, UpdateExpenseStatus);
router.put( "/eduallexpensesdelete/delete/:ID",  VerifyToken, DeleteExpense);




// ========== saidas de caixa ==========


router.get('/eduallcashoutflowlist/get/',   VerifyToken,  GetAllCashOutflows);
router.get('/eduallcashoutflowsingle/get/:ID',   VerifyToken, GetSingleCashOutflow);
router.post('/eduallcashoutflowregister/post/',    RegisterCashOutflow);
router.put('/eduallcashoutflowupdate/put/:ID',    VerifyToken,UpdateCashOutflow);
router.put('/eduallcashoutflowdelete/delete/:ID', VerifyToken,   DeleteCashOutflow);
router.get('/eduallcashoutflowreport/get/',    VerifyToken,    GetCashOutflowReport);




// ========== Relatorios ====================================================
router.get("/eduall/portaria/students/search", VerifyToken,  SearchStudent); 
router.get("/eduall/portaria/student/:STUDENTID", VerifyToken,  GetStudentForPortaria); 
router.get("/eduall/portaria/search",  VerifyToken, SearchResponsavel); 
router.get("/eduall/portaria/responsaveis/:STUDENTID",  VerifyToken, GetAllResponsaveisByStudent); 
router.get("/eduall/portaria/historico/:STUDENTID", VerifyToken,  GetFrequenciaHistorico);
router.post("/eduall/portaria/registar", VerifyToken, RegistrarFrequencia); 
router.post("/eduall/portaria/responsavel/registar",  VerifyToken, uploadResponsavelPortaria,RegisterResponsavelPortaria); 
router.post("/eduall/portaria/temporario", VerifyToken,  RegistrarResponsavelTemporario); 
router.get("/eduall/portaria/geral", VerifyToken,  GetFrequenciaGeral);


// ========== relatorios pedagogicos ==========


router.post('/eduallreports/bulletin-individual', VerifyToken, GenerateIndividualBulletin);
router.post('/eduallreports/minipauta-subject', VerifyToken, GenerateMiniPautaBySubject); 
router.post('/eduallreports/minipauta-class', VerifyToken, GenerateMiniPautaByClass);
router.post('/eduallreports/final-pauta', VerifyToken, GenerateFinalPauta);
router.post('/eduallreports/final-pauta-exam', VerifyToken, GenerateFinalPautaExam);
router.post('/eduallreports/teacher-minipauta', VerifyToken, GenerateTeacherMiniPauta); 
router.post('/eduallreports/bulletin-annual', VerifyToken, GenerateAnnualBulletin);



/////////////////////////
// ===== SESSION =====
/////////////////////////

router.get('/session', (req, res) => {
  res.status(200).json(req.session.user || {});
});





//////////////////////////////
///Multas
//////////////////////////////

initFineCron();  
// Regras
router.get("/eduallmultasrules/get/",  VerifyToken, GetFineRules);
router.post("/eduallmultasrules/post/", VerifyToken, CreateFineRule);
router.put("/eduallmultasrules/update/:id", VerifyToken, UpdateFineRule);
router.put("/eduallmultasrules/toggle/:id", VerifyToken, ToggleFineRule);
router.put("/eduallmultasrules/delete/:id",VerifyToken, DeleteFineRule);
router.post("/eduallmultasrules/conflictcheck/post/",VerifyToken, ConflictCheck); 
router.get("/eduallmultasexclusions/get/:ruleId",VerifyToken, GetExclusions);
router.post("/eduallmultasexclusions/post/",VerifyToken, AddExclusion);
router.put("/eduallmultasexclusions/delete/:id",VerifyToken, RemoveExclusion); 
router.get("/eduallmultaslogs/get/",VerifyToken, GetFineLogs);
router.get("/eduallmultaslogs/student/:studentId",VerifyToken, GetFineLogsByStudent);  
router.post("/eduallmultascalculate/student/post/",VerifyToken, CalculateStudentFine); 
router.post("/eduallmultascron/run/post/",VerifyToken, RunFineEngine); 
router.post("/eduallmultassms/send/post/",VerifyToken, SendSMSToResponsibles);
router.get("/eduallmultassms/credits/get/",VerifyToken, GetSMSCredits); 
router.get("/eduallmultasdevedores/class/:classId", VerifyToken, GetClassDebtors); 
router.get("/eduallmultasclasses/list/", VerifyToken, GetClassListForFines);
router.post("/eduallmultascalculatebyrule/student/post/", VerifyToken, CalculateStudentFineByRule); 
router.post("/eduallunifiedaccountregister/post",VerifyToken, UnifiedAccountRegister);
 


/////////////////////////
// ===== TEST INVOICE =====
/////////////////////////

router.get("/vd", async(req, res) => {
  try {
    const clienteFake = {
      name: "Empresa Teste LDA",
      fiscal_id: "501234567",
      address: "Rua Exemplo, nº 123, Luanda",
      email: "cliente@teste.com"
    };

    const itensFake = [
      { title: "Serviço de Consultoria", price: 15000, tax: true },
      { title: "Suporte Técnico", price: 8000, tax: false }
    ];
 
    res.json(clienteFake);

  } catch (error) {
    console.log(error?.message || "error");
    res.status(400).json(error);
  }
});


 
 


 


// ── ROTAS DE FATURAÇÃO ──────────────────────────────────────────────────────
 
router.get("/eduallgetinvoices/get/", VerifyToken, GetInvoices); 
router.get("/eduallgetsingleinvoice/get/:ID", VerifyToken, GetSingleInvoice); 
router.get("/eduallinvoicebycode/get/:CODE", VerifyToken, GetInvoiceByCode); 
router.get("/eduallinvoicebyvendus/get/:VENDUS_NUMBER", VerifyToken, GetInvoiceByVendusNumber); 
router.post("/eduallregisterinvoice/post/", VerifyToken, RegisterInvoice); 
router.put("/eduallinvoiceupdate/update/:ID", VerifyToken, InvoiceUpdate); 
router.delete("/eduallinvoicedelete/delete/:ID", VerifyToken, InvoiceDelete);

router.get("/check-school-users-access", VerifyToken, async (req, res) => {
  try {
    const institute_code = "edodemoacademiadadialeticadoconhecimento";
 
    const query = `SELECT 
      esa.ed_system_account_id,
      esa.ed_system_account_name,
      ua.ed_user_account_name,
      ua.ed_user_account_email,
      ea.ed_employee_name,
      CASE WHEN uac.ed_user_access_id IS NOT NULL THEN '✅ COM ACESSO' ELSE '❌ SEM ACESSO' END as access_status,
      uac.ed_user_access_id,
      COALESCE(
        (SELECT COUNT(*) FROM (SELECT 1 FROM DUAL WHERE uac.ed_user_access_pedagogicalarea = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_myinstitute = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_portal = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_secretary = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_configuration = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_finances = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_administration = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_library = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_transportation = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_others = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_apps = 1 UNION ALL
         SELECT 1 FROM DUAL WHERE uac.ed_user_access_system = 1) t),
        0
      ) as permissions_count
     FROM eduall_system_accounts esa
     LEFT JOIN eduall_employees ea ON ea.ed_employee_id = esa.ed_system_account_employee
     LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = esa.ed_system_account_userid
     LEFT JOIN eduall_user_access uac ON CAST(esa.ed_system_account_id AS CHAR) = uac.ed_user_access_usercode
     WHERE esa.ed_system_account_institute_code = ?
     AND esa.ed_system_account_app_type = 'library'
     AND esa.ed_system_account_deleted = 0
     AND ua.ed_user_account_deleted = 0
     ORDER BY ua.ed_user_account_name ASC`;
 
    const users = await ExecuteQuery(res, query, [institute_code], true, {
      db: "eduall_school_access",
      type: "select",
      data: req
    });
 
    if (!users) return;
 
    const withAccess = users.filter(u => u.access_status.includes('✅')).length;
    const withoutAccess = users.filter(u => u.access_status.includes('❌')).length;
 
    return res.status(200).json({
      success: true,
      institute_code: institute_code,
      statistics: {
        total: users.length,
        with_access: withAccess,
        without_access: withoutAccess
      },
      users: users
    });
 
  } catch (error) {
    console.error("❌ Erro ao verificar acessos:", error);
    return res.status(500).json({
      success: false,
      msg: "Erro ao verificar acessos de sistema",
      error: error.message
    });
  }
});
 
// ══════════════════════════════════════════════════════════════════════════════
// 🔑 GET - ATUALIZAR ACESSOS (APENAS ExecuteQuery)
// ══════════════════════════════════════════════════════════════════════════════
 
router.get("/update-school-users-access", VerifyToken, async (req, res) => {
  try {
    const institute_code = "edodemoacademiadadialeticadoconhecimento";
 
    console.log(`\n🔄 Iniciando atualização de acessos: ${institute_code}`);
 
    // ════════════════════════════════════════════════════════════════════════
    // PASSO 1: Buscar todos os users
    // ════════════════════════════════════════════════════════════════════════
 
    const queryGetUsers = `SELECT 
      esa.ed_system_account_id,
      esa.ed_system_account_name,
      esa.ed_system_account_employee,
      esa.ed_system_account_userid,
      ua.ed_user_account_name,
      ua.ed_user_account_email,
      ea.ed_employee_name,
      uac.ed_user_access_id,
      CASE WHEN uac.ed_user_access_id IS NOT NULL THEN 1 ELSE 0 END as has_access
     FROM eduall_system_accounts esa
     LEFT JOIN eduall_employees ea ON ea.ed_employee_id = esa.ed_system_account_employee
     LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = esa.ed_system_account_userid
     LEFT JOIN eduall_user_access uac ON CAST(esa.ed_system_account_id AS CHAR) = uac.ed_user_access_usercode
     WHERE esa.ed_system_account_institute_code = ?
     AND esa.ed_system_account_app_type = 'library'
     AND esa.ed_system_account_deleted = 0
     AND ua.ed_user_account_deleted = 0
     ORDER BY ua.ed_user_account_name ASC`;
 
    const libraryUsers = await ExecuteQuery(res, queryGetUsers, [institute_code], true, {
      db: "eduall_school_access",
      type: "select",
      data: req
    });
 
    if (!libraryUsers) return;
 
    console.log(`📊 Total de users encontrados: ${libraryUsers.length}`);
 
    // ════════════════════════════════════════════════════════════════════════
    // PASSO 2: Processar cada user e criar acessos
    // ════════════════════════════════════════════════════════════════════════
 
    let createdCount = 0;
    let alreadyExistCount = 0;
    const usersList = [];
 
    for (const user of libraryUsers) {
      const systemAccountId = user.ed_system_account_id;
      const userName = user.ed_user_account_name || user.ed_employee_name || 'Unknown';
      const userEmail = user.ed_user_account_email || '';
 
      console.log(`👤 ${userName}`);
 
      if (user.has_access === 1) {
        // User já tem acesso
        console.log(`   ✅ Já tem acesso`);
        alreadyExistCount++;
 
        usersList.push({
          user_id: user.ed_system_account_userid,
          system_account_id: systemAccountId,
          system_account_name: user.ed_system_account_name,
          user_name: userName,
          user_email: userEmail,
          employee_name: user.ed_employee_name,
          has_access: true,
          access_id: user.ed_user_access_id,
          status: "already_has_access"
        });
 
      } else {
        // User NÃO tem acesso → criar
        console.log(`   ⚙️  Criando acesso...`);
 
        const insertQuery = `INSERT INTO eduall_user_access (
          ed_user_access_usercode, ed_user_access_pedagogicalarea, ed_user_access_myinstitute,
          ed_user_access_portal, ed_user_access_secretary, ed_user_access_configuration,
          ed_user_access_finances, ed_user_access_administration, ed_user_access_library,
          ed_user_access_transportation, ed_user_access_others, ed_user_access_apps,
          ed_user_access_system, ed_user_access_institute_code, ed_user_access_registerDate
         ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NOW())`;
 
        // Executar INSERT usando ExecuteQuery
        await ExecuteQuery(res, insertQuery, [
          String(systemAccountId),
          0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0,
          1, // ed_user_access_system = 1
          institute_code
        ], false, {
          db: "eduall_school_access",
          type: "insert",
          data: req
        });
 
        createdCount++;
        console.log(`   ✅ Acesso criado`);
 
        usersList.push({
          user_id: user.ed_system_account_userid,
          system_account_id: systemAccountId,
          system_account_name: user.ed_system_account_name,
          user_name: userName,
          user_email: userEmail,
          employee_name: user.ed_employee_name,
          has_access: true,
          status: "access_created"
        });
      }
    }
 
    console.log(`\n✅ Sucesso: ${createdCount} criados, ${alreadyExistCount} já existiam\n`);
 
    // ════════════════════════════════════════════════════════════════════════
    // PASSO 3: Buscar dados finais
    // ════════════════════════════════════════════════════════════════════════
 
    const queryFinalUsers = `SELECT 
      esa.ed_system_account_id,
      esa.ed_system_account_name,
      ua.ed_user_account_name,
      ua.ed_user_account_email,
      ea.ed_employee_name,
      uac.ed_user_access_id,
      uac.ed_user_access_pedagogicalarea,
      uac.ed_user_access_myinstitute,
      uac.ed_user_access_portal,
      uac.ed_user_access_secretary,
      uac.ed_user_access_configuration,
      uac.ed_user_access_finances,
      uac.ed_user_access_administration,
      uac.ed_user_access_library,
      uac.ed_user_access_transportation,
      uac.ed_user_access_others,
      uac.ed_user_access_apps,
      uac.ed_user_access_system
     FROM eduall_system_accounts esa
     LEFT JOIN eduall_employees ea ON ea.ed_employee_id = esa.ed_system_account_employee
     LEFT JOIN eduall_user_accounts ua ON ua.ed_user_account_id = esa.ed_system_account_userid
     LEFT JOIN eduall_user_access uac ON CAST(esa.ed_system_account_id AS CHAR) = uac.ed_user_access_usercode
     WHERE esa.ed_system_account_institute_code = ?
     AND esa.ed_system_account_app_type = 'library'
     AND esa.ed_system_account_deleted = 0
     AND ua.ed_user_account_deleted = 0
     ORDER BY ua.ed_user_account_name ASC`;
 
    const finalUsers = await ExecuteQuery(res, queryFinalUsers, [institute_code], true, {
      db: "eduall_school_access",
      type: "select",
      data: req
    });
 
    if (!finalUsers) return;
 
    // ════════════════════════════════════════════════════════════════════════
    // Formatar resposta
    // ════════════════════════════════════════════════════════════════════════
 
    const formattedUsers = finalUsers.map(user => {
      const permissions = {
        pedagogicalarea: user.ed_user_access_pedagogicalarea === 1,
        myinstitute: user.ed_user_access_myinstitute === 1,
        portal: user.ed_user_access_portal === 1,
        secretary: user.ed_user_access_secretary === 1,
        configuration: user.ed_user_access_configuration === 1,
        finances: user.ed_user_access_finances === 1,
        administration: user.ed_user_access_administration === 1,
        library: user.ed_user_access_library === 1,
        transportation: user.ed_user_access_transportation === 1,
        others: user.ed_user_access_others === 1,
        apps: user.ed_user_access_apps === 1,
        system: user.ed_user_access_system === 1
      };
 
      const permissionsCount = Object.values(permissions).filter(p => p === true).length;
 
      return {
        user_name: user.ed_user_account_name || user.ed_employee_name || 'Unknown',
        user_email: user.ed_user_account_email || '',
        has_system_access: user.ed_user_access_id !== null,
        permissions: permissions,
        permissions_count: permissionsCount
      };
    });
 
    // ════════════════════════════════════════════════════════════════════════
    // Retornar resposta
    // ════════════════════════════════════════════════════════════════════════
 
    return res.status(200).json({
      success: true,
      msg: `✅ ${createdCount} novo(s) acesso(s) criado(s)!`,
      institute_code: institute_code,
      statistics: {
        total_users: libraryUsers.length,
        access_created: createdCount,
        already_existed: alreadyExistCount
      },
      users: formattedUsers
    });
 
  } catch (error) {
    console.error("❌ Erro ao atualizar acessos:", error);
    return res.status(500).json({
      success: false,
      msg: "Erro ao atualizar acessos de sistema",
      error: error.message
    });
  }
});
 
 













module.exports =  router; 
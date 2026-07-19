const express = require("express"); 
const path = require('path');

const { GetSingleStudent, GetSingleStudentByCode,GetStudents, GetStudentsByClass, RegisterStudent, StudentDelete,
   StudentEnrollmentConfirmationUpdate, StudentUpdate, StudentUpdateClass, StudentUpdateEnrollment, uploadStudentPicture,
    tpath, GetSingleStudentByIdentityCard, GetEmails, GetStudentsByInstitute, GetSTDS} = require("../Controllers/Students");
const { CheckExistentEmail, getSingleUserData, GetUserAccounAccess, getUsers, Login, RegisterUserAccounAccess,
   RegisterUserAccount, uploadUserAccountPicture, UserAccountDelete, UpdateUserAccount, getSingleUserImageData,
    CheckUserAccountVerificationCode, UserPasswordReset, UpdateUserPassword, getCurrentUserInformation, UPDATEProfilePicture,
     uploadUserAccountBackgroundPicture, UPDATEProfileCoverImage, SearchUsers, ChangeCurrentUserPassword,
     UpdateUserAccountWhileLoggedin,
     ResetUserPasswordWhileLoggedin} = require("../Controllers/Users");
const VerifyToken  = require("../middleware/VerifyToken");
const { ClassDelete, ClassUpdate, GetClass, GetSingleClass, RegisterClass, GetClassInformation } = require("../Controllers/Class");
const { CourseDelete, CourseUpdate, GetCourse, GetsingleCourse, RegisterCourse } = require("../Controllers/Courses");
const { AcademicyearDelete, AcademicyearUpdate, GetAcademicYear, GetSingleAcademicYear, RegisterAcademicYear } = require("../Controllers/AcademicYear");
const { ClassRoomDelete, ClassRoomUpdate, GetClassroom, GetSingleClassroom, RegisterClassRoom } = require("../Controllers/ClassRoom");
const { CicleDelete, CicleUpdate, GetCicles, GetSingleCicle, RegisterCicle } = require("../Controllers/Cicles");
const { GetSingleSubject, GetSubjects, RegisterSubject, SubjectDelete, SubjectUpdate } = require("../Controllers/Subjects");
const { GetServices, GetSingleService, RegisterService, ServiceDelete, ServiceUpdate, ServiceUpdateDiscountData } = require("../Controllers/Services");
const { GetServicePayments, GetSinglePaidService, GetSingleServicePayment, RegisterServicePayment, Service_paymentDelete, Service_paymentUpdate, uploadServicepaymentDoc } = require("../Controllers/ServicePayments");

const { AcademicLevelDelete, AcademicLevelUpdate, GetAcademicLevel, GetSingleAcademicLevel, RegisterAcademicLevel } = require("../Controllers/AcademicLevel");
const { GetProviders, GetSingleProvider, ProviderDelete, ProviderUpdate, RegisterProvider } = require("../Controllers/Provider");
const { FeePaymentDelete, GetFeepayments, GetSinglePaidMonth, GetSinglePayment, GetSingleStudentFees, RegisterFeepayment, FeePaymentUpdate } = require("../Controllers/FeesPayments");
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
const { GetSingleTiming, GetTimings, RegisterTiming, TimingDelete, TimingUpdate } = require("../Controllers/Timing");
const { GetSchoolsOfProvenance, GetSingleSchoolsOfProvenance, RegisterSchoolsOfProvenance, SchoolsOfProvenanceDelete, SchoolsOfProvenanceUpdate } = require("../Controllers/SchoolsOfProvenance");
const { DeclarationDelete, DeclarationUpdate, GetDeclarations, GetSingleDeclaration, RegisterDeclaration } = require("../Controllers/Declaration"); 
const { GetStudentEnrollments , GetSingleStudentEnrollment, CheckExistentStudentEnrollment, RegisterStudentEnrollment, StudentEnrollmentDelete, StudentEnrollmentUpdate } = require('../Controllers/StudentEnrollment');
const { DeclarationRequestDelete, DeclarationRequestUpdate, GetDeclarationRequests, GetSingleDeclarationRequest, RegisterDeclarationRequest } = require("../Controllers/DeclarationRequests");
const { EnrollOperationDelete, EnrollOperationUpdate, GetEnrollOperations, GetSingleEnrollOperation, RegisterEnrollOperation } = require("../Controllers/EnrollOperations");
const { GetSinglePaidTransportTuitionMonth, GetSingleTransportTuitionpayment, GetTransportTuitionpayments, RegisterTransportTuitionPayment, TransportTuitionPaymentDelete, TransportTuitionPaymentUpadate } = require("../Controllers/TransportTuitions");
const { FeedBackDelete, FeedbackUpdate, GetFeedBacks, GetSingleFeedback, GetSingleUserFeedback, RegisterFeedBack } = require("../Controllers/FeedBacks");
const { GetQuarterlyNotes, GetsingleQuarterlyNote, GetsingleQuarterlyNotebYQrtSub, GetsingleQuarterlyNotebYSubCls, GetsingleQuarterlyNotebYSubStdQrtType, QuarterlyNoteUpdate, RegisterQuarterlyNote, QuarterlyNoteDelete, GetsingleQuarterlyNotebYSubStdQrtTypeClass, GetsingleQuarterlyNoteByID, GetsingleClassScoreByNumber, GetSingleQuarterlyNoteBySubStdQrtType, GetSingleQuarterlyNoteBySubStdQrtTypeClass, GetSingleClassScoreByNumber, GetQuarterlyNotesFullData } = require("../Controllers/QuarterlyNotes");
const { GetSingleInstitute, InstituteUpdate, uploadInstituteLogo, GetSingleInstituteByCode, GetCurrentInstituteByCode, GetCurentLicence, GetInstitutes, EduallSearchInstitutes, RegisterInstitute, GetAllRegisteredInstitutes } = require("../Controllers/Institutes");
const { FineDelete, FineUpdate, GetFines, GetSingleFine, GetSingleFineByService, RegisterFine } = require("../Controllers/Fines");
const RefreshToken = require("../Controllers/RefreshToken");
const { GetJobTitles, GetSingleJobTitle } = require("../Controllers/JobTitles");
const { GetSingleTeacherSubject, GetTeacherSubjects, RegisterTeacherSubject, TeacherSubjectDelete, GetSingleTeacherSubjectById, GetTeacherSubjectsData } = require("../Controllers/TeacherSubject");
const { GetStudentAttendance, GetStudentAttendanceByTeacher, GetStudentAttendanceByTeacherAndClassSub, GetSingleStudentAttendance, GetAllStudentAttendance, RegisterStudentAttendance, StudentAttendanceDelete, StudentAttendanceUpdate, CheckExistentSingleStudentAttendance, GetStudentAttendanceByClassSubStuQrt } = require("../Controllers/StudentAttendance");
const { GetSingleTeachertiming, GetAllTeacherTiming, GetSingleTeacherTiming, GetTeacherTimingByClassSub, RegisterTeacherTiming, TeacherTimingDelete, GetAllClassTimings, GetTeacherTimingsData } = require("../Controllers/TeacherTimings");
const { RegisterPoint, GetPointsBySubClass, GetSinglePoint, PointUpdate, PointDelete } = require("../Controllers/ContinuousAvaliation");
const { GetProjectsByCreator, GetSingleTaskAndProject, GetAllTasksAndProjects, TaskAndProjectDelete, RegisterTaskAndProject } = require("../Controllers/TasksAndProjects");
const { RegisterTaskAndProjectMember, TaskAndProjectMemberDelete, GetMembersByProject } = require("../Controllers/TasksAndProjectsMembers");
const { RegisterLessonSection, GetSingleLessonSection, GetLessonsSectionByGroup, LessonSectionDelete, LessonSectionUpdate, LessonSectionUpdatePosition, GetLessonsSectionBuyGroupCode, GetLessonsSectionByCreator, GetSingerAlbums } = require("../Controllers/LessonsSection");
const { RegisterLessonContent, GetSingleLessonContent, GetLessonsContentBySection, LessonContentSectionDelete, LessonContentSectionUpdate, LessonContentSectionUpdatePosition, GetSingleLessonContentBySection, UploadLessonVideo, UploadLessonVideoPoster, RegisterLessonVideo, RegisterLessonVideoPoster } = require("../Controllers/LessonsSectionContent");
const { RegisterEmployeeAttendance, GetEmployeesAttendance, GetEmployeeAttendanceBycode, EmployeeAttendanceDelete, EmployeeAttendanceUpdate, GetSingleEmployeeAttendance } = require("../Controllers/EmployeeAttendence");
const { GetSingleStudentOldClasses, RegisterOldClass } = require("../Controllers/StudentOldClasses");
const { GetsingleStudentExamNotebYSubStCls, RegisterStudentExamNotes, UpdateStudentExamNotes } = require("../Controllers/StudentExams");
const { GetsingleStudentFeaturedNotebYSubStCls, RegisterStudentFeaturedNotes, UpdateStudentFeaturedNotes } = require("../Controllers/StudentFeaturedNotes");
const { GetSingleUserInstitutes, GetInstituteAccounts, RegisterInstituteAccount, DeleteInstituteAccount, UpdateInstituteAccount, GetSingleInstituteAccount } = require("../Controllers/UserInstitutes");
const { GetSingleUserChilds, ChewckSingleUserChilds, RegisterUserChilds, GetParentsUserChildsByInstitute, GetUserChilds, UserChildDelete } = require("../Controllers/ParentsChilds");
const { RegisteraDS, addAlbum } = require("../Controllers/Ads");
const { RegisterStudentExamCalendar, GetExamsCalendar, GetExamsCalendarByClass, UpdateStudentExamCalendar, DeleteStudentExamCalendar, GetSingleExamCalendar } = require("../Controllers/StudentExamsCalendar");
const { RegisterEnrollment, GetEnrolledStudents, EnrolledStudentDelete, GetSingleEnrolledStudent, GetSingleEnrolledStudentByCode, EnrolledStudentUpdate } = require("../Controllers/Enrollments");
const { RegisterInstituteUserAccount, GetInstituteUserAccounts, GetSingleInstituteUserAccount, DeleteUserInstituteAccount, UpdateInstituteUserAccount } = require("../Controllers/InstituteAccounts");
const SendEmailMessage = require("../Controllers/SendEmailMessage");
const { RegisterPublication, GetPostsForCurrentUser, GetCurrentUserPosts, GetUserPostsByContacts } = require("../Controllers/Posts");
const { UpdateCurrentUserInstitute, GetCurrentUserData } = require("../Controllers/GetCurrentUserData");
const { RegisterStudentUserAccount, GetSingleUserStudentAccounts, GetUsersStudentsAccountsByInstitute, GetSingleUserStudentAccountsByStudent, UserStudentAccountDelete, GetSingleUserStudentAccountsByStudentWorkspaces } = require("../Controllers/UserStudentAccounts");
const ChangeServerNetworkStatus = require("../config/ChangeServerNetworkStatus");
const { RegisterTransportPayments, GetTransportPayments, GetSingleTransportPayment, GetSingleTransportPaidMonth, GetSingleStudentTransportPayments, TransportPaymentsDelete, TransportPaymentsUpdate, GetSingleStudentTransportPaymentsByCode } = require("../Controllers/TransportPayments");
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
    GetSingleSemesterNotebYSubStdQrtTypeClass} = require("../Controllers/SemesterNotes");
const { GetSingleEnrolledConfirmation, EnrollmentConfirmationUpdate, RegisterEnrollmentConfirmation, GetEnrollmentConfirmations, EnrollmentConfirmationDelete, GetSingleEnrolledConfirmationByCode } = require("../Controllers/EnrollmentConfirmation");
const { CalendarEventDelete, GetCalendarEvents, RegisterCalendarEvent, GetSingleCalendarEvent, CalendarEventUpdate } = require("../Controllers/CalendarEvents");
const { GetStatesByCountry } = require("../Controllers/CountriesAndStates");
const { GetAccountsPayableAndReceivable, GetSingleAccountPayableAndReceivable, RegisterAccountPayableAndReceivable, DeleteAccountPayableAndReceivable, UpdateAccountPayableAndReceivable } = require("../Controllers/Accounts_payable_and_receivable");
const { DeleteProductCategory, GetProductCategories, UpdateProductCategory, GetSingleProductCategory, RegisterProductCategory } = require("../Controllers/ProductCategory");
const { GetAdmissionStudents, RegisterAdmissionStudent, GetSingleAdmissionStudent,  DeleteAdmissionStudent, UpdateAdmissionStudent, GetAdmissionExams, RegisterAdmissionExam, 
  GetSingleAdmissionExam, DeleteAdmissionExam, UpdateAdmissionExam, RegisterAdmissionExamSubject,  GetAdmissionExamSubjects, GetAdmissionExamSubjectsByExam, DeleteAdmissionExamSubject, 
  GetAdmissionResults, RegisterAdmissionResult, GetSingleAdmissionResult, DeleteAdmissionResult} = require("../Controllers/Admission");  
const { SendSms, GetAllSentSmS, GetCreditsmsInformations, ResendSms } = require("../Controllers/SendSms");
const { SendEmailToContacts, GetAllSentEmails } = require("../Controllers/SendEmail");
const { DeleteSale, GetSingleSale, RegisterSale, GetProductSales } = require("../Controllers/ProductSalles");
const InvoiceController = require("../Functions/CreateInvoiceCode");
const { generateSAFT } = require("../Functions/CreateSaftFiles");
const { GetBookCollections, RegisterBookCollection, GetSingleBookCollection, BookCollectionDelete, BookCollectionUpdate } = require("../Controllers/BooksCollection");
const { GetAllAuditActionsByInstitute } = require("../Controllers/Auditory");
const { VENUDS_GetInvoicePdf, VENDUS_CreateInvoiceCodeAndDoc } = require("../Functions/VENDUS");
const { GeminiIA, GetIAConversations } = require("../Controllers/0IA");
const { UpdateQuarterlyNoteRestriction, GetQuarterlyNotesPermissions } = require("../Controllers/NotesRestrictions");
const { cacheMiddleware } = require("../middleware/CacheMiddleware"); 

router.get("/" ,  (req, res)=>{
   res.send("Hello my greatest friennds !");
})

router.get("/token", RefreshToken);

const CacheLimitTime_one = 300;
const CacheLimitTime_two = 60;
 
 
// ========== USUÁRIOS ==========
router.get('/eduallusersaccounts/get/', VerifyToken, cacheMiddleware(CacheLimitTime_one), getUsers);
router.get('/students/get/', cacheMiddleware(CacheLimitTime_one), GetSTDS);
router.get('/eduallcheckexistentuseraccountemail/:EMAIL', VerifyToken, cacheMiddleware(CacheLimitTime_two), CheckExistentEmail);
router.get('/eduallsingleuserdata/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), getSingleUserData);
router.get('/eduallgetuserimagebyuser/get/:EMAIL', cacheMiddleware(CacheLimitTime_two), getSingleUserImageData);
router.get('/eduallgetcurrentuserdata/get/', VerifyToken, cacheMiddleware(CacheLimitTime_one), getCurrentUserInformation);
router.get('/eduallsearchusers/search/:TEXT', VerifyToken, cacheMiddleware(CacheLimitTime_two), SearchUsers);
router.get('/eduallgetuseraccess/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetUserAccounAccess);
router.get('/eduallgetsinglesystemuseracccount/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleInstituteUserAccount);
router.get('/eduallinstituteuseraccountsget/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetInstituteUserAccounts);

// Rotas POST, PUT, DELETE (sem cache)
router.post('/eduallusersaccountsignup/post', RegisterUserAccount);
router.post('/login', Login);
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
router.post('/eduallinstituteuseraccountregister/post', RegisterInstituteUserAccount);
router.put('/eduallchangecurrentuserpassword', VerifyToken, ChangeCurrentUserPassword);

// Logout
router.delete('/logout', (req, res, next) => {
  req.session.destroy((err) => {
    if (err) return res.status(500).json({ msg: "Error during logout." });
    res.clearCookie("connect.sid");
    return res.json({ msg: "Logged out successfully." });
  });
});


// ========== DASHBOARD (ESTUDANTES) ==========
router.get('/eduallstudentsapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetStudents);
router.get('/eduallsinglestudentapi/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudent);
router.get('/eduallgetstudentsbyclass/:CLASS', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetStudentsByClass);
router.get('/eduallgetinstitutestudentsbycode/get/:CODE', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetStudentsByInstitute);
router.get('/eduallgetsinglestudentbycode/get/:CODE', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudentByCode);
router.get('/eduallgetstudentbyidenitycard/get/:IDENTITITYCARD', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudentByIdentityCard);
router.get('/eduallenrollmentconfirmations/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetEnrollmentConfirmations);
router.get('/eduallgetsingleenrollmentconfirmation/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleEnrolledConfirmation);
router.get('/eduallgetenrollmentconfirmationbycode/get/:CODE', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleEnrolledConfirmationByCode);
router.get('/eduallstudentenrollments/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetEnrolledStudents);
router.get('/eduallgetsingleenrolledstudent/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleEnrolledStudent);
router.get('/eduallgetsingleenrolledstudentbycode/get/:CODE', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleEnrolledStudentByCode);

// Rotas POST, PUT, DELETE estudantes (sem cache)
router.post('/eduallstudentregisterapi/post', VerifyToken, uploadStudentPicture, RegisterStudent);
router.put('/eduallstudentdelete/delete/:ID', VerifyToken, StudentDelete);
router.put('/eduallstudentupdate/update/:ID', VerifyToken, uploadStudentPicture, StudentUpdate);
router.put('/eduallstudentupdateclass/update/:ID', VerifyToken, StudentUpdateClass);
router.put('/eduallstudentenrollmentupdate/update/:ID', VerifyToken, EnrolledStudentUpdate);
router.put('/eduallstudentenrollmentconfirmationupdate/update/:ID', VerifyToken, EnrollmentConfirmationUpdate);
router.post('/eduallregisterstudentenrollmentconfirmation/post', VerifyToken, RegisterEnrollmentConfirmation);
router.put('/eduallenronllmentconfirmationdelete/delete/:ID', VerifyToken, EnrollmentConfirmationDelete);
router.post('/eduallstudentenrollmentregister/post', VerifyToken, RegisterEnrollment);
router.put('/eduallenrollmentconfirmationcancel/delete/:ID', VerifyToken, EnrolledStudentDelete);

// ========== EMAILS ==========
router.get('/eduallemails/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetEmails);

// ========== CALENDÁRIO ==========
router.get('/eduallgetcalendarevents/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetCalendarEvents);
router.get('/eduallgetsinglecalendarevent/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleCalendarEvent);

// POST e PUT calendário (sem cache)
router.post('/eduallcalendarevenregister/post', VerifyToken, RegisterCalendarEvent);
router.put('/eduallcalendareventdelete/delete/:ID', VerifyToken, CalendarEventDelete);
router.put('/eduallupdatecalendarevent/update/:ID', VerifyToken, CalendarEventUpdate);

// ========== TURMAS ==========
router.get('/eduallclassapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetClass);
router.get('/eduallsingleclassapi/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleClass);
router.get('/eduallgetsingleclassdata/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetClassInformation);

// POST, PUT, DELETE turmas (sem cache)
router.post('/eduallclassregisterapi/post', VerifyToken, RegisterClass);
router.put('/eduallclassdelete/delete/:ID', VerifyToken, ClassDelete);
router.put('/eduallclassupdate/update/:ID', VerifyToken, ClassUpdate);

// ========== CURSOS ==========
router.get('/eduallcoursesapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetCourse);
router.get('/eduallsinglecoursesapi/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleCourse);

// POST, PUT, DELETE cursos (sem cache)
router.post('/eduallcourseregisterapi/post', VerifyToken, RegisterCourse);
router.put('/eduallcoursedelete/delete/:ID', VerifyToken, CourseDelete);
router.put('/eduallcourseupdate/update/:ID', VerifyToken, CourseUpdate);

// ========== ANO ACADÊMICO ==========
router.get('/eduallacademicyearapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAcademicYear);
router.get('/eduallsingleacademicyearapi/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleAcademicYear);

// POST, PUT, DELETE ano acadêmico (sem cache)
router.post('/eduallacademicyeargisterapi/post', VerifyToken, RegisterAcademicYear);
router.put('/eduallacademicyeardelete/delete/:ID', VerifyToken, AcademicyearDelete);
router.put('/eduallacademicyearupdate/update/:ID', VerifyToken, AcademicyearUpdate);

// ========== SALAS ==========
router.get('/eduallclassroomapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetClassroom);
router.get('/eduallsingleclassroomapi/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleClassroom);

// POST, PUT, DELETE salas (sem cache)
router.post('/eduallclassroomregisterapi/post', VerifyToken, RegisterClassRoom);
router.put('/eduallclassroomdelete/delete/:ID', VerifyToken, ClassRoomDelete);
router.put('/eduallclassroomupdate/update/:ID', VerifyToken, ClassRoomUpdate);

// ========== CICLOS ==========
router.get('/eduallciclesapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetCicles);
router.get('/eduallsinglecicle/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleCicle);

// POST, PUT, DELETE ciclos (sem cache)
router.post('/eduallcicleregister/post', VerifyToken, RegisterCicle);
router.put('/eduallcicledelete/delete/:ID', VerifyToken, CicleDelete);
router.put('/eduallcicleupdate/update/:ID', VerifyToken, CicleUpdate);

// ========== DISCIPLINAS ==========
router.get('/eduallsubjectsapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetSubjects);
router.get('/eduallsinglesubject/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleSubject);

// POST, PUT, DELETE disciplinas (sem cache)
router.post('/eduallsubjectregisterapi/post', VerifyToken, RegisterSubject);
router.put('/eduallsubjectdelete/delete/:ID', VerifyToken, SubjectDelete);
router.put('/eduallsubjectupdate/update/:ID', VerifyToken, SubjectUpdate);

// ========== SERVIÇOS ==========
router.get('/eduallservicesapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetServices);
router.get('/eduallsingleserviceapi/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleService);

// POST, PUT, DELETE serviços (sem cache)
router.post('/eduallserviceregisterapi/post', VerifyToken, RegisterService);
router.put('/eduallservicedelete/delete/:ID', VerifyToken, ServiceDelete);
router.put('/eduallserviceupdate/update/:ID', VerifyToken, ServiceUpdate);
router.put('/eduallupdateservicediscount/update/:ID', VerifyToken, ServiceUpdateDiscountData);

// ========== PAGAMENTOS ==========
router.get('/eduallservicepaymentsapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetServicePayments);
router.get('/eduallsingleservicepaymentapi/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleServicePayment);
router.get('/eduallservicecheckpaidmonth/:MONTH,:STUDENTCODE,:SERVICE,:INSTITUTECODE', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSinglePaidService);

router.get('/eduallfeepaymentsapi/get/', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetFeepayments);
router.get('/eduallfeepaymentsingle/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSinglePayment);
router.get('/eduallfeepaymentcheckpaidmonth/:MONTH,:STUDENTCODE,:SERVICE', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSinglePaidMonth);
router.get('/eduallsinglestudentfeepayment/get/:STUDENTCODE,:ACADEMICYEAR', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudentFees);

// POST, PUT, DELETE pagamentos (sem cache)
router.post('/eduallregisterservicepayment/post', VerifyToken, uploadServicepaymentDoc, RegisterServicePayment);
router.put('/eduallservicepaymentdelete/delete/:ID', VerifyToken, Service_paymentDelete);
router.put('/eduallservicepaymentupdate/update/:ID', VerifyToken, Service_paymentUpdate);
router.put('/eduallfeepaymentsdelete/delete/:ID', VerifyToken, FeePaymentDelete);
router.put('/eduallfeepaymentupdate/update/:ID', VerifyToken, FeePaymentUpdate);
router.post('/eduallregisterfeepayment/post', VerifyToken, RegisterFeepayment);

// ========== NÍVEIS ACADÊMICOS ==========
router.get('/eduallacademiclevelsapi/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAcademicLevel);
router.get('/eduallsingleacademiclevelsapi/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleAcademicLevel);

// POST, PUT, DELETE níveis acadêmicos (sem cache)
router.post('/eduallregisteracademiclevel/post', VerifyToken, RegisterAcademicLevel);
router.put('/eduallacademicleveldelete/delete/:ID', VerifyToken, AcademicLevelDelete);
router.put('/eduallacademiclevelupdate/update/:ID', VerifyToken, AcademicLevelUpdate);

// ========== FORNECEDORES ==========
router.get('/eduallprovidersapi/get/', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetProviders);
router.get('/eduallgetsingleprovider/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleProvider);

// POST, PUT, DELETE fornecedores (sem cache)
router.post('/eduallregisterprovider/post/', VerifyToken, RegisterProvider);
router.put('/eduallproviderdelete/delete/:ID', VerifyToken, ProviderDelete);
router.put('/eduallproviderupdate/update/:ID', VerifyToken, ProviderUpdate);

// ========== HORÁRIOS ==========
router.get('/edualltimings/get/', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTimings);
router.get('/eduallgetsingletiming/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTiming);
router.get('/eduallgetclasstimings/get/:CODE', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetAllClassTimings);

// POST, PUT, DELETE horários (sem cache)
router.post('/eduallregistertiming/post/', VerifyToken, RegisterTiming);
router.put('/edualltimingdelete/delete/:ID', VerifyToken, TimingDelete);
router.put('/edualltimingupdate/update/:ID', VerifyToken, TimingUpdate);

// ========== ESCOLAS DE PROCEDÊNCIA ==========
router.get('/eduallschoolsofprovenance/get/', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetSchoolsOfProvenance);
router.get('/eduallgetsingleschoolofprovenance/get/:ID', VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleSchoolsOfProvenance);

// POST, PUT, DELETE escolas de procedência (sem cache) 
router.post("/eduallregisterschoolofprovenance/post/", VerifyToken, RegisterSchoolsOfProvenance); 
router.put("/eduallschoolofprovenancedelete/delete/:ID", VerifyToken, SchoolsOfProvenanceDelete);
router.put("/eduallschoolofprovenanceupdate/update/:ID", VerifyToken, SchoolsOfProvenanceUpdate);

 
 // --- CONTATOS ---
router.post("/eduallregisterinstitutecontact/post", VerifyToken, uploadContactPicture, RegisterContact);

router.get("/eduallgetinstitutecontacts/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetContacts);
router.get("/eduallgetcontactmessagebycontactemail/get/:EMAIL", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetContactMessagesByContact);
router.get("/eduallgetsinglecontact/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleContact);

router.put("/eduallcontactdelete/delete/:ID", VerifyToken, ContactDelete);
router.put("/eduallcontactupdate/update/:ID", VerifyToken, uploadContactPicture, ContactUpdate);

// --- TRANSPORTE ---
router.post("/eduallregistetransportpayment/post/", VerifyToken, RegisterTransportPayments);

router.get("/edualltransportpaymentsapi/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTransportPayments);
router.get("/edualltransportpaymentsingle/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTransportPayment);

router.get("/edualltransportpaymentcheckpaidmonth/:MONTH,:STUDENTCODE,:YEAR", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTransportPaidMonth);
router.get("/eduallsinglestudenttransportpayment/get/:PASSENGERCODE,:ACADEMICYEAR", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudentTransportPayments);
router.get("/eduallgetstudenttransportpaymentsbycode/get/:STUDENTCODE,:ACADEMICYEAR", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudentTransportPaymentsByCode);

router.put("/edualltransportpaymentsdelete/delete/:ID", VerifyToken, TransportPaymentsDelete);
router.put("/edualltransportpaymentupdate/update/:ID", VerifyToken, TransportPaymentsUpdate);

// --- CARGOS ---
router.get("/eduallgetjobtitles/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetJobTitles);
router.get("/eduallgetsinglejobtitle/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleJobTitle);

// --- MOEDAS ---
router.get("/eduallcoinsapi/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetCoins);
router.post("/eduallregistercoins/post/", VerifyToken, RegisterCoin);
router.put("/eduallcoindelete/delete/:ID", VerifyToken, CoinDelete);
router.get("/eduallsinglecoinget/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleCoin);
router.put("/eduallcoinupdate/update/:ID", VerifyToken, CoinUpdate);

// --- PRODUTOS ---
router.post("/eduallproductsregister/post", VerifyToken, uploadProductPicture, RegisterProducts);
router.get("/eduallproductsapi/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetProducts);
router.get("/eduallsingleproductapi/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleProduct);
router.put("/eduallproductdelete/delete/:ID", VerifyToken, ProductDelete);
router.put("/eduallproductupdate/update/:ID", VerifyToken, uploadProductPicture, ProductUpdate);

// --- FUNCIONÁRIOS ---
router.get("/eduallemployeesget/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), Getemployees);
router.get("/eduallgetemployeebyjobtitle/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetEmployeeByJobTitle);
router.get("/eduallsinglemployee/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleEmployee);

router.post("/eduallemployeeregister/post/", VerifyToken, uploadEmployeePicture, RegisterEmployee);
router.put("/eduallemployeedelete/delete/:ID", VerifyToken, EmployeeDelete);
router.put("/eduallemployeeupdate/update/:ID", VerifyToken, uploadEmployeePicture, EmployeeUpdate);

router.get("/eduallgetsingleuserandemployeedata/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetEmployeeDataByUser);

// --- PROFESSORES E DISCIPLINAS ---
router.get("/eduallgetteachersubjects/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetTeacherSubjects);
router.get("/eduallgetsingleteachersubjects/get/:CODE,:ID,:CLASS", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTeacherSubject);
router.get("/eduallGetSingleTeacherSubjectById/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTeacherSubjectById);

router.post("/eduallregisterteachersubject/post/", VerifyToken, RegisterTeacherSubject);
router.put("/eduallteachersubjectdelete/delete/:ID", VerifyToken, TeacherSubjectDelete);

router.get("/eduallgetallteachersubjects/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTeacherSubjectsData);
router.get("/eduallgetallteachertimings/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTeacherTimingsData);

// --- ARQUIVOS ---
router.post("/eduallfilesregister/post/", VerifyToken, uploadFiles, RegisterFile);
router.get("/eduallsingleuserfiles/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSpecificFiles);
router.put("/eduallfiledelete/delete/:ID", VerifyToken, FileDelete);

// --- CLASSES ANTIGAS DOS ALUNOS ---
router.get("/eduallgetsinglestudentoldclasses/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudentOldClasses);
router.post("/eduallregisterstudentoldclass/post/", VerifyToken, RegisterOldClass);

// --- TRANSFERÊNCIA DE ALUNOS ---
router.post("/eduallstudenttransferenceregister/post", VerifyToken, RegisterStudentTransference);
router.get("/eduallstudenttransferences/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetStudentTransferences);
router.get("/eduallsinglestudenttransference/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudentTransference);

router.put("/eduallstudenttransferencedelete/:ID", VerifyToken, StudentTransferenceDelete);
router.put("/eduallstudenttransferenceupdate/update/:ID", VerifyToken, StudentTransferenceUpdate);

// --- TÍTULOS E CABEÇALHOS ---
router.post("/edualltitlesandheadersregister/post", VerifyToken, RegisterTitleAndHeader);
router.get("/eduallgetsingletitleandheader/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTitleAndHeader);
router.get("/eduallgettitlesandheaders/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTitleAndHeaders);
router.put("/edualltitleandheaderdelete/delete/:ID", VerifyToken, TitleAndHeaderDelete);
router.put("/edualltitleandheaderupdate/update/:ID", VerifyToken, TitleAndHeaderUpdate);

// --- OPERAÇÕES DE MATRÍCULA ---
router.post("/eduallenrolloperationregister/post", VerifyToken, RegisterEnrollOperation);
router.get("/eduallgetsingleenrolloperation/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleEnrollOperation);
router.get("/eduallgetenrolloperations/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetEnrollOperations);
router.put("/eduallenrolloperationdelete/delete/:ID", VerifyToken, EnrollOperationDelete);
router.put("/eduallenrolloperationupdate/update/:ID", VerifyToken, EnrollOperationUpdate);

// --- PAIS / ENCARREGADOS ---
router.get('/eduallparents/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), Getparents);
router.post('/eduallparentregister/post', VerifyToken, uploadParentPicture, RegisterParent);
router.get("/eduallsingleparent/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleparent);
router.put("/eduallparentdelete/delete/:ID", VerifyToken, ParentDelete);
router.put("/eduallparenteupdate/update/:ID", VerifyToken, uploadParentPicture, ParentUpdate);

// --- AUTORES DE LIVROS ---
router.get('/edualllibraryauthor/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAuthors);
router.post('/edualllibraryauthorregister/post', VerifyToken, RegisterAuthor);
router.get("/eduallsinglelibraryauthor/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleAuthor);
router.put("/edualllibraryauthordelete/delete/:ID", VerifyToken, AuthorDelete);
router.put("/edualllibraryauthorupdate/update/:ID", VerifyToken, AuthorUpdate);

// --- MATRÍCULAS DOS ALUNOS ---
router.get('/eduallstudentenrollments/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetStudentEnrollments);
router.post('/eduallstudentenrollmentregister/post', VerifyToken, RegisterStudentEnrollment);
router.get("/eduallsinglestudentenrollment/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudentEnrollment);
router.get("/eduallchecksinglestudentenrollment/get/:STUDENT", VerifyToken, cacheMiddleware(CacheLimitTime_two), CheckExistentStudentEnrollment);
router.put("/eduallstudentenrollmentdelete/delete/:ID", VerifyToken, StudentEnrollmentDelete);
router.put("/eduallstudentenrollmentupdate/update/:ID", VerifyToken, StudentEnrollmentUpdate);

// --- EDITORAS ---
router.get('/edualllibrarypublishers/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetPublishers);
router.post('/edualllibrarypublisherregister/post', VerifyToken, RegisterPublisher);
router.get("/eduallsinglelibrarypublisher/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSinglePublisher);
router.put("/edualllibrarypublisherdelete/delete/:ID", VerifyToken, PublisherDelete);
router.put("/edualllibrarypublisherupdate/update/:ID", VerifyToken, PublisherUpdate);

// --- DECLARAÇÕES ---
router.get('/edualldeclarationrequests/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetDeclarationRequests);
router.post('/edualldeclarationrequestregister/post', VerifyToken, RegisterDeclarationRequest);
router.get("/eduallsingledeclarationrequest/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleDeclarationRequest);
router.put("/edualldeclarationrequestdelete/delete/:ID", VerifyToken, DeclarationRequestDelete);
router.put("/edualldeclarationrequestupdate/update/:ID", VerifyToken, DeclarationRequestUpdate);

// --- TIPOS DE LIVROS ---
router.get('/edualllibrarytypeofbooks/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTypeofbooks);
router.post('/edualllibrarytypeofbookregister/post/', VerifyToken, RegisterTypeofbook);
router.get("/eduallsinglelibrarytypeofbook/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTypeofbook);
router.put("/edualllibrarytypeofbookdelete/delete/:ID", VerifyToken, TypeofbookDelete);
router.put("/edualllibrarytypeofbookupdate/update/:ID", VerifyToken, TypeofbookUpdate);

// --- CATEGORIAS DE LIVROS ---
router.get('/edualllibrarytypecategories/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetBookCategories);
router.post('/edualllibrarycategoryregister/post/', VerifyToken, RegisterBookCategory);
router.get("/eduallsinglelibrarycategory/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleBookCategory);
router.put("/edualllibrarycategorydelete/delete/:ID", VerifyToken, BookCategoryDelete);
router.put("/edualllibrarycategoryupdate/update/:ID", VerifyToken, BookCategoryUpdate);

// --- ESTANTES ---
router.get('/edualllibraryracks/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetRacks);
router.post('/edualllibraryrackregister/post', VerifyToken, RegisterRack);
router.get("/eduallsinglelibraryrack/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleRack);
router.put("/edualllibraryrackdelete/delete/:ID", VerifyToken, RackDelete);
router.put("/edualllibraryrackupdate/update/:ID", VerifyToken, RackUpdate);

// --- LIVROS ---
router.get('/edualllibrarybooks/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetBooks);
router.post('/edualllibrarybookregister/post', VerifyToken, uploadBookCover, RegisterBook);
router.get("/eduallsinglelibrarybook/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleBook);
router.put("/edualllibrarybookdelete/delete/:ID", VerifyToken, BookDelete);
router.put("/edualllibrarybookupdate/update/:ID", VerifyToken, uploadBookCover, BookUpdate);

// --- COLEÇÕES DE LIVROS ---
router.get('/edualllibrarycollectiongetall/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetBookCollections);
router.post('/edualllibrarycollectionregister/post', VerifyToken, RegisterBookCollection);
router.get("/edualllibrarygetsinglecollection/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleBookCollection);
router.put("/edualllibrarydeletecollection/delete/:ID", VerifyToken, BookCollectionDelete);
router.put("/edualllibraryupdatecollection/update/:ID", VerifyToken, BookCollectionUpdate);

// --- LIVROS EMPRESTADOS ---
router.get('/edualllibraryborrowedbooks/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetBorrowedBooks);
router.post('/edualllibraryborrowbookregister/post', VerifyToken, RegisterBorrowedBook);
router.get("/eduallsinglelibraryborrowedbook/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleBorrowedBook);
router.put("/edualllibraryborrowedbookdelete/delete/:ID", VerifyToken, BorrowedBookDelete);
router.put("/edualllibraryborrowedbookupdate/update/:ID", VerifyToken, BorrowedBookUpdate);

// --- FEEDBACKS ---  
router.get("/eduallsinglefeedback/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleFeedback); 
router.put("/eduallfeedbackupdate/update/:ID", VerifyToken, FeedbackUpdate);

 

// --- ESCOLAS ---
router.get('/eduallinstitutes/get', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetInstitutes);
router.post('/eduallinstituteregister/post', VerifyToken, RegisterInstitute);
router.get("/eduallsingleinstitute/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleInstitute); 
router.put("/eduallinstituteupdate/update/:ID", VerifyToken, InstituteUpdate);

 
// ===========================
// ======== CLASSES ==========
// ===========================

// Notas por semestre e subclasses
router.get('/eduallsemesternotesbysubclasssm/get/', VerifyToken, cacheMiddleware(CacheLimitTime_one), GetsingleSemesterNotebYQrtSub);
router.get("/eduallsinglesemesternotebysemsubcls/get/:SEMESTER,:SUBJECT,:CLASS", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleSemesterNotebYQrtSub); 
router.get("/eduallsinglesemesternotebysmtsubstdqrttypeclass/get/:SUBJECT,:STUDENT,:SEMESTER,:CLASS", cacheMiddleware(CacheLimitTime_two), GetSingleSemesterNotebYSubStdQrtTypeClass);
router.get("/eduallgetsemesternotebyid/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleSemesterNoteByID);
router.get("/eduallgetstudentsemesternotesbyclassandsemester/get/:STUDENT,:SEMESTER,:CLASS", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleStudentSemesterNotebYCls);

router.post("/eduallregistersemesternotes/post/", VerifyToken, RegisterSemesterNote);
router.put("/eduallsemesternotesupdate/update/:ID", VerifyToken, SemesterNoteUpdate); 
router.put("/eduallsemesternotesdelete/delete/:ID", VerifyToken, SemesterNoteDelete);

// Notas dos exames por classe e matéria
router.get("/eduallgetstudentexamscorebyclassubject/:SUBJECT,:STUDENT,:CLASS", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleStudentExamNotebYSubStCls);
router.post("/eduallstudentexamscoreregister/post", VerifyToken, RegisterStudentExamNotes);
router.put("/eduallstudentexamscoreupdate/update/:ID", VerifyToken, UpdateStudentExamNotes);

// Notas em destaque por classe e matéria
router.get("/eduallgetstudentfeaturedscorebyclassubject/:SUBJECT,:STUDENT,:CLASS", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleStudentFeaturedNotebYSubStCls);
router.post("/eduallstudentfeaturedscoreregister/post", VerifyToken, RegisterStudentFeaturedNotes);
router.put("/eduallstudentfeaturedscoreupdate/update/:ID", VerifyToken, UpdateStudentFeaturedNotes);


// ===========================
// ======== ESTUDANTES =======
// ===========================

// Presença dos estudantes
router.get("/eduallgetallstudentsattendance/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetStudentAttendance);
router.get("/eduallgetstudentsattendancebyteacher/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetStudentAttendanceByTeacher);
router.get("/eduallgetstudentattendancebyteacherclassandsub/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetStudentAttendanceByTeacherAndClassSub);
router.get("/eduallgetsinglestudentattendance/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleStudentAttendance);
router.get("/eduallgetallstudentattendance/get/:CODE,:CLASS", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetAllStudentAttendance);
router.get("/eduallgetstudentattendancebyclqrtsubjstcode/get/:CLASS,:SUBJECT,:STUDENT,:QRT", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetStudentAttendanceByClassSubStuQrt);

router.put("/eduallstudentattendancedelete/delete/:ID", VerifyToken, StudentAttendanceDelete);
router.put("/eduallstudentattendanceupdate/update/:ID", VerifyToken, StudentAttendanceUpdate);
router.post("/eduallstudentattendanceregister/post", VerifyToken, RegisterStudentAttendance);
router.get("/eduallcheckexistentstudentattendance/get/:CLASS,:SUBJECT,:STUDENT,:TIME,:DATE", VerifyToken, cacheMiddleware(CacheLimitTime_two), CheckExistentSingleStudentAttendance);


// ===========================
// ======== PROFESSORES ======
// ===========================

// Horários dos professores
router.get("/eduallgetallteachertiming/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetAllTeacherTiming);
router.get("/eduallgetsingleteachertiming/get/:ID,:CODE,:CLASS,:SUBJECT", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTeacherTiming);
router.get("/eduallgetteachertimingbyclasssub/get/:SUBJECT,:CLASS,:CODE,:ID/", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetTeacherTimingByClassSub);
router.put("/edualldeleteteachertiming/delete/:ID", VerifyToken, TeacherTimingDelete);
router.post("/eduallteachertimingregister/post", VerifyToken, RegisterTeacherTiming);


// ===========================
// ======== PONTOS (CTNAVL) ===
// ===========================

router.post("/eduallregisterctnavlpoint/post", VerifyToken, RegisterPoint);
router.get("/eduallgetctnavlpointsbysubclass/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetPointsBySubClass);
router.put("/eduallgetctnavlpointsbysubclass/delete/:ID", VerifyToken, PointDelete);
router.put("/eduallgetctnavlpointsbysubclass/update/:ID", VerifyToken, PointUpdate);
router.get("/eduallgetsinglectnavlpoints/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSinglePoint);


// ===========================
// ======== TAREFAS E PROJETOS ==========
// ===========================

router.get("/eduallgetalltasksandprojects/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAllTasksAndProjects);
router.get("/eduallgettasksandprojectsbycreator/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetProjectsByCreator);
router.get("/eduallgetsingletaskandproject/get/:ID/", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTaskAndProject);
router.post("/eduallcreatenewtaskandproject/post/", VerifyToken, RegisterTaskAndProject);
router.put("/eduallsingletaskandproject/delete/:ID", VerifyToken, TaskAndProjectDelete);

router.get("/eduallgettaskandprojectmembers/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetMembersByProject);
router.post("/eduallregistertaskandprojectmember/post", VerifyToken, RegisterTaskAndProjectMember);
router.put("/edualltaskandprojectdelete/delete/:ID", VerifyToken, TaskAndProjectMemberDelete);


// ===========================
// ======== LIÇÕES E SEÇÕES =======
// ===========================

router.get("/eduallgetlessonssectionbygroup/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetLessonsSectionByGroup);
router.get("/eduallgetsinglelessonssection/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleLessonSection);
router.post("/eduallcreatelessonsection/post/", VerifyToken, RegisterLessonSection);
router.put("/edualllessonsectionupdateposition/update/:ID", VerifyToken, LessonSectionUpdatePosition);
router.put("/edualllessonsectionupdate/update/:ID", VerifyToken, LessonSectionUpdate);
router.put("/edualllessonsectiondelete/delete/:ID", VerifyToken, LessonSectionDelete);
router.get("/edualllessonsectionbygroupcode/:GROUP", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetLessonsSectionBuyGroupCode);

router.get("/edualllessonsectionbycreator/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetLessonsSectionByCreator);

// Conteúdos das lições
router.get("/eduallgetlessonscontentbysection/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetLessonsContentBySection);
router.get("/eduallgetsinglelessoncontent/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleLessonContent);
router.post("/edualllessoncontentregister/post/", VerifyToken, RegisterLessonContent);
router.put("/edualllessoncontentdelete/delete/:ID", VerifyToken, LessonContentSectionDelete);
router.put("/edualllessoncontentupdate/update/:ID", VerifyToken, LessonContentSectionUpdate);
router.get("/eduallgetlessoncontentbysection/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleLessonContentBySection);
router.put("/edualllessoncontentupdateposition/update/:ID", VerifyToken, LessonContentSectionUpdatePosition);

router.post("/edualllessoncontentregistervideo/post/", VerifyToken, UploadLessonVideo, RegisterLessonVideo);
router.post("/edualllessoncontentregistervideoposter/post/", VerifyToken, UploadLessonVideoPoster, RegisterLessonVideoPoster);


// ===========================
// ======== FUNCIONÁRIOS =======
// ===========================

router.get("/eduallgetallemployeesattendence/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetEmployeesAttendance);
router.get("/eduallgetemployeeattendencebycode/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetEmployeeAttendanceBycode);
router.get("/eduallgetsingleemployeeattendence/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleEmployeeAttendance);
router.post("/eduallregisteremployeeattendence/post/", VerifyToken, RegisterEmployeeAttendance);
router.put("/eduallemployeeattendencedelete/delete/:ID", VerifyToken, EmployeeAttendanceDelete);
router.put("/eduallemployeeattendenceupdate/update/:ID", VerifyToken, EmployeeAttendanceUpdate);


// ===========================
// ======== COMENTÁRIOS E REAÇÕES =======
// ===========================

router.get("/eduallgetlessonreviewsbylessonid/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetLessonsReviewsByLesson);
router.get("/eduallgetCommentsDatabyidandtype/:ID,:TYPE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GeCommentsByContentIdAndType);
router.get("/eduallgetCommentsrepliesbyid/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GeCommentsRepliesByCommentId);
router.get("/eduallgetCommentssubrepliesbyid/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GeCommentsSubRepliesByReplietId);
router.get("/eduallgetcommentreactionbyidandtype/:ID,:TYPE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GeCommentReactionsByReplietIdAndType);


// ===== TRANSPORTE ===== 

// Rotas de transporte - rotas
router.post("/edualltransportrouteregister/post/", VerifyToken, RegisterTransportRoute);
router.get("/edualltransportroutesget/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTransportRoutes);
router.get("/edualltransportsinglerouteget/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleTransportRoute);
router.put("/edualltransportroutedelete/delete/:ID", VerifyToken, TransportRouteDelete);
router.put("/edualltransportrouteupdate/update/:ID", VerifyToken, TransportRouteUpdate);

// Rotas de transporte - passageiros
router.post("/edualltransportpassengerregister/post/", VerifyToken, RegisterTransportPassenger);
router.get("/edualltransportpassengerget/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTransportPassengers);
router.get("/edualltransportsinglepassengerget/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetTransportsinglePassenger);
router.put("/edualltransportpassengerdelete/delete/:ID", VerifyToken, TransportPassengerDelete);
router.put("/edualltransportpassengerupdate/update/:ID", VerifyToken, TransportPassengerUpdate);
router.get("/eduallgetpassengerbystudentcode/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetTransportsinglePassengerByStudentId);

// Rotas de transporte - veículos
router.post("/edualltransportvehicleregister/post/", VerifyToken, uploadTransportVehiclePicture, RegisterTransportVehicle);
router.get("/edualltransportvehicleget/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTransportVehicles);
router.get("/edualltransportsinglevehicleget/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTransportVehicle);
router.put("/edualltransportvehicledelete/delete/:ID", VerifyToken, TransportVehicleDelete);
router.put("/edualltransportvehicleupdate/update/:ID", VerifyToken, uploadTransportVehiclePicture, TransportVehicleUpdate);

// Rotas de transporte - manutenção
router.post("/edualltransportmaintenanceeregister/post/", VerifyToken, RegisterTransportMaintenance);
router.get("/edualltransportmaintenanceget/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTransportMaintenances);
router.get("/edualltransportsinglemaintenanceget/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleTransportMaintenance);
router.put("/edualltransportmaintenancedelete/delete/:ID", VerifyToken, TransportMaintenanceDelete);
router.put("/edualltransportmainenanceupdate/update/:ID", VerifyToken, TransportMaintenanceUpdate);

// Rotas de transporte - paradas
router.post("/edualltransportstopsregister/post/", VerifyToken, RegisterTransportStop);
router.get("/edualltransportstopsget/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTransportStops);
router.get("/edualltransportsinglestopget/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleTransportStop);
router.put("/edualltransportstopsdelete/delete/:ID", VerifyToken, TransportStopDelete);
router.put("/edualltransportstopupdate/update/:ID", VerifyToken, TransportStopUpdate);

// Rotas de transporte - motoristas
router.post("/edualltransportdriverregister/post/", VerifyToken, uploadTransportDriverPicture, RegisterTransportDriver);
router.get("/edualltransportdriversget/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetTransportDrivers);
router.get("/edualltransportsingledriverget/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleTransportDriver);
router.put("/edualltransportsdriverdelete/delete/:ID", VerifyToken, TransportDriverDelete);
router.put("/edualltransportdriverupdate/update/:ID", VerifyToken, uploadTransportDriverPicture, TransportDriverUpdate);


// ===== MULTAS E SERVIÇOS =====

// Consultas e alterações de multas
router.get("/eduallgetsinglefinebyservice/get/:SERVICE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleFineByService);
router.get("/eduallgetservicefines/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetFines);
router.put("/eduallfineupdate/update/:ID", VerifyToken, FineUpdate);
router.put("/eduallfinedelete/delete/:ID", VerifyToken, FineDelete);
router.get("/eduallgetsinglefine/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleFine);
router.post("/eduallfineregister/post", VerifyToken, RegisterFine);


// ===== REQUISIÇÕES =====

router.post("/eduallregisterrequest/post/", VerifyToken, RegisterRequest);
router.get("/eduallgetrequests/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetRequests);
router.put("/eduallrequestupdate/update/:ID", VerifyToken, RequestUpdate);
router.get("/eduallgetsinglerequest/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetsingleRequest);
router.put("/eduallrequestdelete/delete/:ID", VerifyToken, RequestDelete);


// ===== ÁLBUNS E MÚSICA =====

router.post("/edualladsregister/post/:ID", VerifyToken, RegisteraDS);
router.get("/eduallgetsingeralbums/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetSingerAlbums);


// ===== FACULDADES =====

router.get("/eduallgetfaculties/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetFaculties);
router.get("/eduallgetsinglefaculty/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleFaculty);
router.post("/eduallregisterfaculty/post/", VerifyToken, RegisterFaculty);
router.put("/eduallfacultydelete/delete/:ID", VerifyToken, FacultyDelete);
router.put("/eduallfacultyupdate/update/:ID", VerifyToken, FacultyUpdate);


// ===== INSTITUTOS =====

router.get("/eduallgetsingleinstitute/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleInstitute);
router.put("/eduallupdateinstitute/update/", VerifyToken, uploadInstituteLogo, InstituteUpdate);
router.get("/eduallgetsingleinstitutebycode/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleInstituteByCode);
router.get("/eduallgetcurentuserinstitute/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetCurrentInstituteByCode);
router.get("/eduallgetallinstitutes/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetInstitutes);

// Licença dos institutos
router.get("/eduallgetinstitutelicencestatus/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetCurentLicence);
router.post("/eduallupdatecurrentinstitutecode/post/:CODE", VerifyToken, UpdateCurrentUserInstitute);


// ===== CONTAS DE ACESSO AO PORTAL DO PROFESSOR =====

router.get("/eduallgetsingleuserinstitutes/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleUserInstitutes);
router.get("/eduallgetalluserinstitutes/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetInstituteAccounts);
router.post("/eduallregisteruserinstitutes/post", VerifyToken, RegisterInstituteAccount);
router.get("/eduallgetsingleuserinstitutes/getx/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleInstituteAccount);
router.put("/eduallupdateuserinstitutes/update/:ID", VerifyToken, UpdateInstituteAccount);
router.put("/edualldeleteuserinstitutes/delete/:ID", VerifyToken, DeleteInstituteAccount);
 

///////////////////////
// ===== CLASSES =====
///////////////////////

// Rotas GET sem parâmetros -> CacheLimitTime_one
router.get("/eduallgetsingleuserchilds/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetSingleUserChilds);

// Rotas GET com parâmetros -> CacheLimitTime_two
router.get("/eduallchecksingleuserchild/get/:USERCODE,:STUDENTCODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), ChewckSingleUserChilds);
router.get("/eduallgetuserchilds/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetUserChilds);

// Outros métodos (POST, PUT) sem cache
router.post("/edualluserchildregister/post/", VerifyToken, RegisterUserChilds);
router.get("/eduallgetuserparentsacccountsbyinstitute/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetParentsUserChildsByInstitute);
router.put("/edualluserchildaccountdelete/delete/:ID", VerifyToken, UserChildDelete);

//////////////////////////
// ===== ESTUDANTES =====
//////////////////////////

// POST e PUT sem cache
router.post("/eduallstudentexamcalendarregister/post", VerifyToken, RegisterStudentExamCalendar);

// GETs com e sem parâmetros
router.get("/eduallstudentexamcalendarget/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetExamsCalendar);
router.get("/eduallstudentexamcalendargetsingle/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleExamCalendar);
router.get("/eduallstudentexamcalendargetbyclass/get/:CLASS", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetExamsCalendarByClass);

router.put("/eduallstudentexamcalendarupdate/update/:ID", VerifyToken, UpdateStudentExamCalendar);
router.put("/eduallstudentexamcalendardelete/delete/:ID", VerifyToken, DeleteStudentExamCalendar);

///////////////////////////
// ===== CONEXÕES =====
///////////////////////////

router.get("/eduallgetcurrentuserconnections/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetCurrentUserConnections);
router.post("/eduallcreatechatmessage/post/", VerifyToken, CreateChatMessage);
router.get("/eduallgetchatmessagesbycontact/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetChatMessagesByContact);

//////////////////////////////////////
// ===== USER STUDENT ACCOUNTS =====
//////////////////////////////////////

router.post("/edualluserstudentaccountregister/post", VerifyToken, RegisterStudentUserAccount);

router.get("/eduallsingleuserstudentaccountsget/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleUserStudentAccounts);
router.get("/eduallsingleuserstudentaccountsgetbystudent/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleUserStudentAccountsByStudent);
router.get("/eduallsingleuserstudentaccountsgetbystudent/workspaces/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleUserStudentAccountsByStudentWorkspaces);
router.get("/eduallgetuserstudentsaccounts/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetUsersStudentsAccountsByInstitute);

router.put("/edualluserstudentsaccountdelete/delete/:ID", VerifyToken, UserStudentAccountDelete);

/////////////////////////////////
// ===== STUDENT BEHAVIOR =====
/////////////////////////////////

router.post("/eduallstudentbehaviorregister/post/", VerifyToken, RegisterStudentBehavior);
router.get("/eduallgetstudentbehaviorbystudentcode/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetAllStudentBehaviorByStudentCode);

/////////////////////////////
// ===== PUBLICATIONS =====
/////////////////////////////

router.post("/eduallpublicationregister/post", VerifyToken, RegisterPublication);

router.get("/eduallgetpostforcurrentuser/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetPostsForCurrentUser);
router.get("/eduallgetcurrentuiserposts/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetCurrentUserPosts);
router.get("/eduallgetpostsbyusercontactsandfollowers/get", cacheMiddleware(CacheLimitTime_one), GetUserPostsByContacts);

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
router.get("/eduallcheckiffollowinginstitute/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), CheckIfFollowingInstitute);

router.get("/eduallgetinstitutefollowers/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleInstituteFollowers);

router.get("/eduallinstitutessearch/search/:TEXT", VerifyToken, cacheMiddleware(CacheLimitTime_two), EduallSearchInstitutes);

////////////////////////////////
// ===== USER CONTACTS =====
////////////////////////////////

router.post("/eduallmakeusercontactrequest/post", VerifyToken, MakeUserContactRequest);
router.get("/eduallcheckifuserisacontact/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), CheckUserContactRequest);
router.post("/eduallprofilepageregistervisitor/post", VerifyToken, RegisterProfilePageVisitor);

/////////////////////////////////////
// ===== CP PAGES (Conteúdo) =====
/////////////////////////////////////

router.get("/eduallgetsinglecppagebycd/get/:CODE", cacheMiddleware(CacheLimitTime_two), GetSingleCpPageByCode);

////////////////////////////////////////////
// ===== ACCOUNTS PAYABLE & RECEIVABLE =====
////////////////////////////////////////////

router.get("/eduallgetaccounts_payable_and_receivable/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAccountsPayableAndReceivable);
router.get("/eduallgetsingleaccount_payable_and_receivable/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleAccountPayableAndReceivable);
router.post("/eduallregisteraccount_payable_and_receivable/post/", VerifyToken, RegisterAccountPayableAndReceivable);
router.put("/eduallaccount_payable_and_receivabledelete/delete/:ID", VerifyToken, DeleteAccountPayableAndReceivable);
router.put("/eduallaccount_payable_and_receivableupdate/update/:ID", VerifyToken, UpdateAccountPayableAndReceivable);

///////////////////////////////////////
// ===== PRODUCT CATEGORY =====
///////////////////////////////////////

router.get("/eduallgetproduct_category/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetProductCategories);
router.get("/eduallgetsingleproduct_category/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleProductCategory);
router.post("/eduallregisterproduct_category/post/", VerifyToken, RegisterProductCategory);
router.put("/eduallproduct_categorydelete/delete/:ID", VerifyToken, DeleteProductCategory);
router.put("/eduallproduct_categoryupdate/update/:ID", VerifyToken, UpdateProductCategory);

///////////////////////////////////////
// ===== ADMISSION STUDENTS =====
///////////////////////////////////////

router.get("/edualladmissionstudents/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAdmissionStudents);
router.post("/eduallregisteradmissionstudent/post/", VerifyToken, RegisterAdmissionStudent);
router.get("/eduallsingleadmissionstudent/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleAdmissionStudent);
router.put("/edualladmissionstudentdelete/delete/:ID", VerifyToken, DeleteAdmissionStudent);
router.put("/edualladmissionstudentupdate/update/:ID", VerifyToken, UpdateAdmissionStudent);

///////////////////////////////////////
// ===== ADMISSION EXAMS =====
///////////////////////////////////////

router.get("/edualladmissionexams/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAdmissionExams);
router.post("/eduallregisteradmissionexam/post/", VerifyToken, RegisterAdmissionExam);
router.get("/eduallsingleadmissionexam/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleAdmissionExam);
router.put("/edualladmissionexamdelete/delete/:ID", VerifyToken, DeleteAdmissionExam);
router.put("/edualladmissionexamupdate/update/:ID", VerifyToken, UpdateAdmissionExam);

///////////////////////////////////////
// ===== ADMISSION EXAM SUBJECTS =====
///////////////////////////////////////

router.get("/edualladmissionexamsubjects/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAdmissionExamSubjects);
router.get("/edualladmissionexamsubjectsbyexam/get/:CODE", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetAdmissionExamSubjectsByExam);
router.post("/eduallregisteradmissionexamsubject/post/", VerifyToken, RegisterAdmissionExamSubject);
router.put("/edualladmissionexamsubjectdelete/delete/:ID", VerifyToken, DeleteAdmissionExamSubject);

///////////////////////////////////////
// ===== ADMISSION RESULTS =====
///////////////////////////////////////

router.get("/edualladmissionresults/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAdmissionResults);
router.post("/eduallregisteradmissionresult/post/", VerifyToken, RegisterAdmissionResult);
router.get("/eduallsingleadmissionresult/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleAdmissionResult);
router.put("/edualladmissionresultdelete/delete/:ID", VerifyToken, DeleteAdmissionResult);

//////////////////////////
// ===== SMS & EMAIL =====
//////////////////////////

router.get("/eduallgetsmscredits/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetCreditsmsInformations);
router.get("/eduallgetallsentsms/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAllSentSmS);
router.post("/eduallsendsmsmessage/post/", VerifyToken, SendSms);
router.post("/eduallresendsmsmessage/post/:ID", VerifyToken, ResendSms);
router.post("/eduallsendemailmessage/post/", VerifyToken, SendEmailToContacts);
router.get("/eduallgetallsentemails/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAllSentEmails);

//////////////////////////
// ===== SALES =====
//////////////////////////

router.get("/eduallgetallproductsales/get/", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetProductSales);
router.post("/eduallregisterproductssales/post/", VerifyToken, RegisterSale);
router.get("/eduallgetsinglesale/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetSingleSale);
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
router.get("/eduall_mn_getallinstitutes/get", cacheMiddleware(CacheLimitTime_one), GetAllRegisteredInstitutes);
router.get("/eduall_mn_getstatebycountry/get/:ID", cacheMiddleware(CacheLimitTime_two), GetStatesByCountry);

//////////////////////
// ===== AUDITORY =====
//////////////////////

router.get("/eduallgetcurrentinstituteauditory/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetAllAuditActionsByInstitute);
router.get("/eduallinvoicedoc/:id/pdf", VerifyToken, VENUDS_GetInvoicePdf);

//////////////////////
// ===== PARENTS & KIDS =====
//////////////////////

router.post("/eduallparentkids/register", VerifyToken, RegisterParentKid);
router.get("/eduallparentkidsstudents/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetParentKids);
router.get("/eduallparentkidsparents/get/:ID", VerifyToken, cacheMiddleware(CacheLimitTime_two), GetKidsParents);
router.put("/eduallparentkids/delete/:ID", VerifyToken, ParentkidDelete);

//////////////////////
// ===== GEMINI IA =====
//////////////////////

router.post("/eduallgeminiiarequest/post", VerifyToken, GeminiIA);
router.get("/eduallgeminiallconversations", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetIAConversations);

///////////////////////////
// ===== PEDAGOGY =====
///////////////////////////

router.put("/eduallpedagogyrestriction/update", VerifyToken, UpdateQuarterlyNoteRestriction);
router.get("/eduallgetquarterpermittions/get", VerifyToken, cacheMiddleware(CacheLimitTime_one), GetQuarterlyNotesPermissions);

/////////////////////////
// ===== SESSION =====
/////////////////////////

router.get('/session', cacheMiddleware(CacheLimitTime_one), (req, res) => {
  res.status(200).json(req.session.user || {});
});

/////////////////////////
// ===== TEST INVOICE =====
/////////////////////////

router.post("/vd", async(req, res) => {
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

    const invoiceData = await VENDUS_CreateInvoiceCodeAndDoc(clienteFake, itensFake);
    console.log(invoiceData);
    res.json(invoiceData);

  } catch (error) {
    console.log(error?.message || "error");
    res.status(400).json(error);
  }
});

 

module.exports =  router; 
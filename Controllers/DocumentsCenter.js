const ExecuteQuery = require("../Functions/ExecuteQuery");
const { RegisterAuditAction } = require("./Auditory");
const sanitizeHtml = require("sanitize-html");

const sanitizeOptions = {
   allowedTags: [
      "html","head","body","title","meta","link",
      "div","section","article","header","footer",
      "table","thead","tbody","tr","td","th",
      "ul","ol","li",
      "p","span","b","strong","i","em",
      "h1","h2","h3","h4","h5","h6",
      "img","style","br","hr"
   ],
   allowedAttributes: {
      "*": ["class","style"],
      "img": ["src","alt","width","height"],
      "meta": ["charset","name","content"],
      "link": ["rel","href"]
   },
   allowedSchemes: ["http","https","data"],
   disallowedTagsMode: "discard",
   enforceHtmlBoundary: true
};

const sanitizeDocumentHTML = (html = "") => {

   if (typeof html !== "string") {
      throw new Error("Invalid HTML");
   }

   if (html.length > 2000000) {
      throw new Error("HTML too large");
   }

   let clean = sanitizeHtml(html, sanitizeOptions);

   clean = clean
      .replace(/<script[\s\S]*?>[\s\S]*?<\/script>/gi, "")
      .replace(/on\w+="[^"]*"/g, "")
      .replace(/on\w+='[^']*'/g, "")
      .replace(/javascript:/gi, "");

   return clean.trim();
};

const GenerateDocumentCode = () => {
   return `DOC-${Date.now()}-${Math.floor(Math.random()*99999)}`;
};

const FormatDocumentName = (name="") => {
   return name
      .toLowerCase()
      .split(" ")
      .map(word => word.length > 3
         ? word.charAt(0).toUpperCase() + word.slice(1)
         : word
      )
      .join(" ");
};

const GetDocuments = async (req, res) => {
   try {

      const CODE = req.session.user.eduall_user_session_curentinstitute;
      const USER = req.session.user.eduall_user_session_ID;

      const query = `
      SELECT DISTINCT d.*
      FROM eduall_document_center d
      LEFT JOIN eduall_document_access a
        ON a.ed_doc_access_document = d.ed_doc_id
        AND a.ed_doc_access_institute_code = ?
      WHERE d.ed_doc_deleted = 0
      AND (
            a.ed_doc_access_public = 1
            OR a.ed_doc_access_user = ?
         )
      AND (a.ed_doc_access_blocked = 0 OR a.ed_doc_access_blocked IS NULL)
      AND (
            a.ed_doc_access_start IS NULL
            OR a.ed_doc_access_start <= NOW()
         )
      AND (
            a.ed_doc_access_end IS NULL
            OR a.ed_doc_access_end >= NOW()
         )
      ORDER BY d.ed_doc_recordDate DESC
      `;

      const rows = await ExecuteQuery(
         res,
         query,
         [CODE, USER],
         true,
         { db:"eduall_document_center", type:"select", data:req }
      );

      res.status(200).json(rows);

   } catch (error) {

      res.status(500).json({
         success:false,
         message:"Failed to fetch documents!",
         error:error.message
      });

   }
};

const GetSingleDocument = async (req, res) => {

   try {

      const CODE = req.session.user.eduall_user_session_curentinstitute;
      const USER = req.session.user.eduall_user_session_ID;
      const { ID } = req.params;

      const query = `
      SELECT d.*
      FROM eduall_document_center d
      LEFT JOIN eduall_document_access a
        ON a.ed_doc_access_document = d.ed_doc_id
        AND a.ed_doc_access_institute_code = ?
      WHERE d.ed_doc_id = ?
      AND d.ed_doc_deleted = 0
      AND (
            a.ed_doc_access_public = 1
            OR a.ed_doc_access_user = ?
         )
      AND (a.ed_doc_access_blocked = 0 OR a.ed_doc_access_blocked IS NULL)
      AND (
            a.ed_doc_access_start IS NULL
            OR a.ed_doc_access_start <= NOW()
         )
      AND (
            a.ed_doc_access_end IS NULL
            OR a.ed_doc_access_end >= NOW()
         )
      LIMIT 1
      `;

      const rows = await ExecuteQuery(
         res,
         query,
         [CODE, ID, USER],
         true,
         { db:"eduall_document_center", type:"select", data:req }
      );

      if(!rows.length){
         return res.status(403).json({
            success:false,
            message:"Access denied"
         });
      }

      res.status(200).json(rows);

   } catch (error) {

      res.status(500).json({
         success:false,
         message:"Failed to fetch document!",
         error:error.message
      });

   }
};

const GrantDocumentAccess = async (req,res)=>{

try{

const CODE = req.session.user.eduall_user_session_curentinstitute;

const {
document_id,
users = [],
public_access = 0,
blocked = 0,
start_date = null,
end_date = null
} = req.body;

await ExecuteQuery(
res,
`DELETE FROM eduall_document_access
WHERE ed_doc_access_document = ?
AND ed_doc_access_institute_code = ?`,
[document_id,CODE],
false,
{db:"eduall_document_access",type:"delete",data:req}
);

if(public_access){

await ExecuteQuery(
res,
`INSERT INTO eduall_document_access(
ed_doc_access_document,
ed_doc_access_public,
ed_doc_access_blocked,
ed_doc_access_institute_code,
ed_doc_access_start,
ed_doc_access_end
) VALUES(?,?,?,?,?,?)`,
[document_id,1,blocked,CODE,start_date,end_date],
false,
{db:"eduall_document_access",type:"insert",data:req}
);

}else{

const placeholders = [];
const values = [];

users.forEach(user=>{

placeholders.push("(?,?,?,?,?,?)");

values.push(
document_id,
user,
CODE,
blocked,
start_date,
end_date
);

});

if(placeholders.length){

await ExecuteQuery(
res,
`INSERT INTO eduall_document_access(
ed_doc_access_document,
ed_doc_access_user,
ed_doc_access_institute_code,
ed_doc_access_blocked,
ed_doc_access_start,
ed_doc_access_end
) VALUES ${placeholders.join(",")}`,
values,
false,
{db:"eduall_document_access",type:"insert",data:req}
);

}

}

await RegisterAuditAction({
session:req.session,
action:2,
form:"Centro de Documentos Global",
description:`Definiu acessos do documento ${document_id}`
});

res.status(200).json({msg:"Access updated"});

}catch(error){

res.status(500).json({
success:false,
message:"Failed to update access!",
error:error.message
});

}

};

const RegisterDocument = async (req, res) => {

   try {

      const cleanHTML = sanitizeDocumentHTML(req.body.doc_htmlCode);

      const result = await ExecuteQuery(
         res,
         `INSERT INTO eduall_document_center(
            ed_doc_name,
            ed_doc_uniqueCode,
            ed_doc_htmlCode,
            ed_doc_htmlText,
            ed_doc_thumbnail,
            ed_doc_externalCode,
            ed_doc_created_by,
            ed_doc_institute_code
         )
         VALUES(?,?,?,?,?,?,?,?)
         `,
         [
            FormatDocumentName(req.body.doc_name),
            GenerateDocumentCode(),
            cleanHTML,
            cleanHTML,
            req.body.thumbnail || "",
            req.body.externalCode || null,
            req.session.user.eduall_user_session_ID,
req.session.user.eduall_user_session_curentinstitute

         ],
         false,
         { db:"eduall_document_center", type:"insert", data:req }
      );

      const documentId = result.insertId;

      await ExecuteQuery(
         res,
         `INSERT INTO eduall_document_access(
            ed_doc_access_document,
            ed_doc_access_public,
            ed_doc_access_institute_code
         ) VALUES(?,?,?)`,
         [documentId,1,req.session.user.eduall_user_session_curentinstitute],
         false,
         { db:"eduall_document_access", type:"insert", data:req }
      );

      await RegisterAuditAction({
         session:req.session,
         action:1,
         form:"Centro de Documentos Global",
         description:`Registrou um novo documento (${req.body.doc_name})`
      });

      res.status(200).json(result);

   } catch (error) {

      res.status(500).json({
         success:false,
         message:"Failed to register document!",
         error:error.message
      });

   }
};

const UpdateDocument = async (req, res) => {

   try {

      const cleanHTML = sanitizeDocumentHTML(req.body.doc_htmlCode);

      const rows = await ExecuteQuery(
         res,
         `UPDATE eduall_document_center SET
            ed_doc_name = ?,
            ed_doc_htmlCode = ?,
            ed_doc_htmlText = ?,
            ed_doc_thumbnail = ?
          WHERE ed_doc_deleted = 0
          AND ed_doc_id = ?`,
         [
            FormatDocumentName(req.body.doc_name),
            cleanHTML,
            cleanHTML,
            req.body.thumbnail || "",
            req.params.ID
         ],
         false,
         { db:"eduall_document_center", type:"update", data:req }
      );

      await RegisterAuditAction({
         session:req.session,
         action:2,
         form:"Centro de Documentos Global",
         description:`Atualizou o documento (${req.body.doc_name})`
      });

      res.status(200).json(rows);

   } catch (error) {

      res.status(500).json({
         success:false,
         message:"Failed to update document!",
         error:error.message
      });

   }
};

const DeleteDocument = async (req, res) => {

   try {

      const rows = await ExecuteQuery(
         res,
         `UPDATE eduall_document_center
          SET ed_doc_deleted = 1
          WHERE ed_doc_id = ?`,
         [req.params.ID],
         false,
         { db:"eduall_document_center", type:"update", data:req }
      );

      await RegisterAuditAction({
         session:req.session,
         action:3,
         form:"Centro de Documentos Global",
         description:`Eliminou o documento ID ${req.params.ID}`
      });

      res.status(200).json(rows);

   } catch (error) {

      res.status(500).json({
         success:false,
         message:"Failed to delete document!",
         error:error.message
      });

   }
};

const RegisterDocumentsFromArray = async (documents=[], req=null) => {

   try {

      const existingDocs = await ExecuteQuery(
         null,
         `SELECT ed_doc_externalCode FROM eduall_document_center`,
         [],
         true,
         { db:"eduall_document_center", type:"select", data:req }
      );

      const existingCodes = new Set(
         existingDocs.map(doc => Number(doc.ed_doc_externalCode))
      );

      const newDocs = documents.filter(doc =>
         !existingCodes.has(Number(doc.code))
      );

      if(!newDocs.length){
         return;
      }

      const values = [];
      const placeholders = [];

      newDocs.forEach(doc => {

         placeholders.push("(?,?,?,?,?,?)");

         const cleanHTML = sanitizeDocumentHTML(doc.htmlreport);

         values.push(
            FormatDocumentName(doc.name || "Documento"),
            GenerateDocumentCode(),
            cleanHTML,
            cleanHTML,
            doc.thumbnail || "",
            doc.code
         );

      });

      await ExecuteQuery(
         null,
         `INSERT INTO eduall_document_center(
            ed_doc_name,
            ed_doc_uniqueCode,
            ed_doc_htmlCode,
            ed_doc_htmlText,
            ed_doc_thumbnail,
            ed_doc_externalCode
         ) VALUES ${placeholders.join(",")}`,
         values,
         false,
         { db:"eduall_document_center", type:"insert", data:req }
      );

   } catch (error) {

      console.error(error);

   }
};

module.exports = {
   GetDocuments,
   GetSingleDocument,
   RegisterDocument,
   UpdateDocument,
   DeleteDocument,
   RegisterDocumentsFromArray,
   GrantDocumentAccess
};

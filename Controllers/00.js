 Gostaria que o meu code do pagamento de transporte. fosse mais gual ao do pagamentode propians desde os toggles, ui cores, code dos slados etc:



 code do pagamento de propians:






 import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
 import styled from "styled-components";
 import AddCircleOutlineIcon from "@mui/icons-material/AddCircleOutline";
 import { Modal, Form, Button, Badge, Alert } from "react-bootstrap";
 import {
   AccessTimeOutlined,
   Check,
   Close,
   DeleteOutline,
   InfoOutlined,
   Update,
   MonetizationOn,
 } from "@mui/icons-material";
 import { IoWalletOutline, IoAlertCircleOutline, IoCheckmarkCircle } from "react-icons/io5";
 import DraggableModal from "../../../General/components/DraggableModal";
 import axios from "axios";
 import Hoot from "../../../General/components/Hoot";
 import { Checkbox, FormControlLabel } from "@mui/material";
 import FileUpload from "../../../General/components/FileUpload";
 import ClearInputs from "../../../General/components/ClearInputs";
 import CRValue from "../../../General/components/CRValue";
 import toast from "react-hot-toast";
 import {
   AcademicYearDataOptions,
   ServiceDataOptions,
   StudentsDataOptions,
   GetInstituteCode,
   StudentsArray,
   GetServicePrice,
 } from "../../../General/components/InstituteData";
 import { MultiSelect } from "react-multi-select-component";
 import SelectSearch from "react-select-search";
 import NotFounded from "../../../General/components/NotFounded";
 import { HiOutlineDocumentText } from "react-icons/hi";
 import ReduceTextLength from "../../../General/components/ReduceTextLength";
 import DeleteModal from "../elements/DeleteModal";
 import NumberToBytes from "../../../General/components/NumberToBytes";
 import RefreshList from "../../../General/components/RefreshList";
 import StudentDetailsMenu from "../elements/StudentDetailsMenu";
 import SaveButton from "../elements/SaveButton";
 import Loader from "../../../General/components/Loader";
 import NumberToPrice from "../../../General/components/NumberToPrice";
 import AnimatedModal from "../../../General/components/AnimatedModal";
 import UserOptionDropDown from "../elements/UserOptionDropDown";
 import { ModalAnimationClose, ModalAnimationShow } from "../../../General/components/ModalAnimations";
 import GenerateInvoiceCode from "../../../General/components/GenerateInvoiceCode";
 import { BalanceBadge, StudentBalanceModal } from "./StudenceBalanceModal";
 
 // ─── CONSTANTE: Tipo de pagamento = 4 → "Saldo do aluno" ───────────────────
 const PAYMENT_TYPE_BALANCE = 4;
 
 // ─── Helper de formatação de moeda ───────────────────────────────────────────
 const fmtMoney = (v, coin = "") =>
   `${Number(v || 0).toLocaleString("pt-AO", {
     minimumFractionDigits: 2,
     maximumFractionDigits: 2,
   })}${coin ? " " + coin : ""}`;
 
 /**
  * ═══════════════════════════════════════════════════════════════════════════
  * SELETOR DE CRÉDITOS PARCIAIS
  * ═══════════════════════════════════════════════════════════════════════════
  * 
  * Permite ao operador escolher quanto do saldo disponível usar:
  *   - Slider de 0 até saldo disponível
  *   - Input numérico direto
  *   - Botões rápidos: "Usar tudo", "Metade", "Não usar"
  *   - Resumo detalhado: créditos usados, saldo restante, valor ainda a pagar
  * 
  * Exemplo:
  *   Saldo disponível: 2000 KZ
  *   Total da propina: 24000 KZ
  *   Operador escolhe: usar 1000 KZ
  *   → Resultado: 23000 KZ a cobrar por outro método
  */
 function BalanceCreditSelector({ balance, total, coin, editAmount, onChange }) {
   if (balance === null || balance === undefined) return null;
 
   // Máximo que pode ser usado = min(saldo disponível, total da fatura)
   const maxUsable   = Math.min(Number(balance), Number(total));
   
   // Valor atual selecionado (ou máximo se ainda não foi tocado)
   const current     = editAmount !== null && editAmount !== undefined 
     ? Number(editAmount) 
     : 0; // Começa em 0 (operador escolhe deliberadamente)
   
   // Quanto ainda falta pagar após usar os créditos
   const remaining   = Math.max(0, Number(total) - current);
   
   // Quanto saldo sobra após esta transação
   const balanceLeft = Number(balance) - current;
   
   // Indica se a fatura fica totalmente paga com este saldo
   const fullyPaid   = remaining <= 0;
 
   return (
     <CreditSelectorBox fullyPaid={fullyPaid}>
       {/* ─── CABEÇALHO ─────────────────────────────────────────────────────── */}
       <div className="cs-header">
         <span className="cs-title">
           <IoWalletOutline size={14} />
           Créditos a usar neste pagamento
         </span>
         <span className="cs-available">
           Disponível: <strong>{fmtMoney(balance, coin)}</strong>
         </span>
       </div>
 
       {/* ─── SLIDER ────────────────────────────────────────────────────────── */}
       <input
         type="range"
         min={0}
         max={maxUsable}
         step={1}
         value={current}
         onChange={(e) => onChange(Number(e.target.value))}
         className="cs-slider"
         title={`Arrastar para escolher entre 0 e ${fmtMoney(maxUsable, coin)}`}
       />
 
       {/* ─── INPUT NUMÉRICO + BOTÕES RÁPIDOS ──────────────────────────────── */}
       <div className="cs-input-row">
         <div className="cs-input-wrap">
           <input
             type="number"
             min={0}
             max={maxUsable}
             step={1}
             value={current}
             onChange={(e) => {
               const v = Math.min(Math.max(0, Number(e.target.value)), maxUsable);
               onChange(v);
             }}
             className="cs-input"
             placeholder="0"
             title="Introduza o valor em números"
           />
           <span className="cs-coin">{coin}</span>
         </div>
         <div className="cs-quick-btns">
           <button 
             type="button" 
             className="cs-btn cs-btn-all" 
             onClick={() => onChange(maxUsable)}
             title={`Usar todo o saldo: ${fmtMoney(maxUsable, coin)}`}
           >
             Usar tudo
           </button>
           <button 
             type="button" 
             className="cs-btn cs-btn-half" 
             onClick={() => onChange(Math.floor(maxUsable / 2))}
             title={`Usar metade: ${fmtMoney(Math.floor(maxUsable / 2), coin)}`}
           >
             Metade
           </button>
           <button 
             type="button" 
             className="cs-btn cs-btn-none" 
             onClick={() => onChange(0)}
             title="Não usar créditos neste pagamento"
           >
             Não usar
           </button>
         </div>
       </div>
 
       {/* ─── RESUMO DE 3 COLUNAS ──────────────────────────────────────────── */}
       <div className={`cs-summary ${fullyPaid ? "cs-summary--ok" : "cs-summary--partial"}`}>
         {/* Coluna 1: Créditos usados */}
         <div className="cs-summary-item">
           <div className="cs-summary-label">Créditos usados</div>
           <div className="cs-summary-value cs-purple">
             {fmtMoney(current, coin)}
           </div>
         </div>
         <div className="cs-summary-divider" />
         
         {/* Coluna 2: Saldo após pagamento */}
         <div className="cs-summary-item">
           <div className="cs-summary-label">Saldo após pagamento</div>
           <div className={`cs-summary-value ${balanceLeft < 0 ? "cs-red" : "cs-green"}`}>
             {fmtMoney(balanceLeft, coin)}
           </div>
         </div>
         <div className="cs-summary-divider" />
         
         {/* Coluna 3: Ainda a pagar */}
         <div className="cs-summary-item">
           <div className="cs-summary-label">Ainda a pagar</div>
           <div className={`cs-summary-value ${remaining > 0 ? "cs-orange" : "cs-green"}`}>
             {remaining > 0 ? (
               <>
                 <IoAlertCircleOutline size={12} style={{ marginRight: 3 }} /> 
                 {fmtMoney(remaining, coin)}
               </>
             ) : (
               <>
                 <IoCheckmarkCircle size={12} style={{ marginRight: 3 }} /> 
                 Coberto
               </>
             )}
           </div>
         </div>
       </div>
 
       {/* ─── AVISOS INFORMATIVOS ──────────────────────────────────────────── */}
       {remaining > 0 && current > 0 && (
         <div className="cs-warning">
           <strong>⚠ Pagamento parcial</strong><br />
           Faltam <strong>{fmtMoney(remaining, coin)}</strong> — 
           o operador deverá cobrar a diferença por outro método.
         </div>
       )}
       
       {current === 0 && (
         <div className="cs-info">
           ℹ Sem créditos aplicados neste pagamento.<br />
           O valor total será cobrado por outro método.
         </div>
       )}
       
       {fullyPaid && current > 0 && (
         <div className="cs-success">
           ✓ Fatura totalmente coberta pelo saldo do aluno!
         </div>
       )}
     </CreditSelectorBox>
   );
 }
 
 // ═════════════════════════════════════════════════════════════════════════════
 // COMPONENTE PRINCIPAL: NewfeeManualPaymentModal
 // ═════════════════════════════════════════════════════════════════════════════
 
 function NewfeeManualPaymentModal(props) {
   const SH      = props.pop === true;
   const prefill = props.prefill || null;
 
   // ── ESTADO DO FORMULÁRIO ──────────────────────────────────────────────────
   const [show,         setShow]         = useState(false);
   const [showBox,      setShowBox]      = useState(false);
   const [form,         setForm]         = useState({});
   const [errors,       setErrors]       = useState({});
   const [files,        setFiles]        = useState([]);
   const [currentFiles, setCurrentFiles] = useState([]);
 
   const [studentCode,       setStudentCode]       = useState("");
   const [serviceCode,       setServiceCode]       = useState(null);
   const [servicePrice,      setServicePrice]      = useState(null);
   const [serviceCoin,       setServiceCoin]       = useState("");
   const [serviceDiscount,   setServiceDiscount]   = useState(0);
   const [serviceIva,        setServiceIva]        = useState(0);
 
   const [extraServicesEnabled, setExtraServicesEnabled] = useState(false);
   const [extraServices,        setExtraServices]        = useState([]);
 
   const [serviceFine,     setServiceFine]     = useState(0);
   const [serviceFineType, setServiceFineType] = useState(0);
   const [applyDiscount,   setApplyDiscount]   = useState(null);
   const [applyFine,       setApplyFine]       = useState(false);
   const [nonePaidMonths,  setNonePaidMonths]  = useState(0);
 
   const [paymentType,    setPaymentType]    = useState(null);
   const [monthOptions,   setMonthOptions]   = useState([]);
   const [selectedMonths, setSelectedMonths] = useState([]);
   const [invoiceValue,   setInvoiceValue]   = useState("0");
   const [balancePreview, setBalancePreview] = useState(0);
 
   const [parentsData,     setParentsData]     = useState([]);
   const [fineData,        setFineData]        = useState([]);
   const [registerStatus,  setRegisterStatus]  = useState(null);
   const [founded,         setFounded]         = useState(null);
 
   const [currentMonth,         setCurrentMonth]         = useState();
   const [currentService,       setCurrentService]       = useState();
   const [currentAcademicYear,  setCurrentAcademicYear]  = useState();
   const [currentPaymentMethod, setCurrentPaymentMethod] = useState();
 
   const [docfile, setDocfile] = useState(false);
 
   // ── ESTADO DO SALDO DO ALUNO ──────────────────────────────────────────────
   const [studentBalance,        setStudentBalance]        = useState(null);
   const [studentBalanceCoin,    setStudentBalanceCoin]    = useState("");
   const [studentBalanceLoading, setStudentBalanceLoading] = useState(false);
   const balanceDeductedRef = useRef(false);
   const [showBalanceCanvas, setShowBalanceCanvas] = useState(false);
 
   // ✓ NOVO: Valor PARCIAL do saldo que o operador quer usar
   // Começa em null (operador ainda não escolheu)
   // Quando escolhe, pode ser qualquer valor de 0 até min(saldo, total)
   const [balanceEditAmount, setBalanceEditAmount] = useState(null);
 
   const ChildRef = useRef();
 
   // ── URLs ──────────────────────────────────────────────────────────────────
   const URL = useMemo(() => ({
     batchRegister:      Hoot() + "eduallregisterfeepayment/post/",
     checkPaidMonth:     Hoot() + "eduallfeepaymentcheckpaidmonth/",
     singleService:      Hoot() + "eduallsingleserviceapi/get/",
     getRecord:          props.get  || "",
     updateRecord:       props.url  || "",
     singleStudent:      Hoot() + "eduallsinglestudentapi/get/",
     singleClass:        Hoot() + "eduallsingleclassapi/get/",
     singleAcademicYear: Hoot() + "eduallsingleacademicyearapi/get/",
     filesUpload:        Hoot() + "eduallfilesregister/post/",
     listFilesByCode:    Hoot() + "eduallsingleuserfiles/get/",
     fineByService:      Hoot() + "eduallgetsinglefinebyservice/get/",
     parents:            Hoot() + "eduallparents/get/",
     instituteIVA:       Hoot() + "eduallgetsingleinstitute/get/1",
     studentBalance:     Hoot() + "eduallstudentbalance/",
     balanceDeduct:      Hoot() + "eduallstudentbalancededuct",
   }), []);
 
   const MonthsList = useMemo(() => [
     "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
     "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro",
   ], []);
 
   // ── HELPERS ───────────────────────────────────────────────────────────────
   const handleClose = () => {
     setShowBox(false);
     setTimeout(() => {
       setShow(false);
       if (typeof props.onClose === "function") props.onClose();
     }, 300);
   };
 
   const handleShow = () => {
     setShowBox(true);
     setShow(true);
     setTimeout(() => {
       if (props.update && URL.getRecord) loadRecordForUpdate();
     }, 150);
   };
 
   const showBoxFile = () => setDocfile((v) => !v);
   const GetFiles    = (arr) => setFiles(arr);
 
   const setField = (field, value) => {
     setForm((f) => ({ ...f, [field]: value }));
     if (errors[field]) setErrors((e) => ({ ...e, [field]: null }));
   };
 
   const monthLabel = (mDotY) => {
     const m = String(mDotY).split(".")[0] * 1;
     const y = String(mDotY).split(".")[1] * 1;
     const N = ["Jan","Fev","Mar","Abr","Mai","Jun","Jul","Ago","Set","Out","Nov","Dez"];
     if (Number.isFinite(m) && Number.isFinite(y)) return `${N[m]} / ${y}`;
     return String(mDotY);
   };
 
   const addExtraService    = () => setExtraServices((a) => [...a, { name: "", value: "" }]);
   const removeExtraService = (idx) => setExtraServices((a) => a.filter((_, i) => i !== idx));
   const updateExtraService = (idx, key, val) =>
     setExtraServices((a) => a.map((it, i) => (i === idx ? { ...it, [key]: val } : it)));
 
   const totalExtraServices = useCallback(() =>
     (extraServicesEnabled ? extraServices : []).reduce((sum, it) => {
       const v = parseFloat(String(it.value).replace(",", "."));
       return sum + (Number.isFinite(v) ? v : 0);
     }, 0), [extraServicesEnabled, extraServices]);
 
   // ── BUSCAR SALDO DO ALUNO ─────────────────────────────────────────────────
   const fetchStudentBalance = useCallback(async (sid) => {
     if (!sid) { 
       setStudentBalance(null); 
       setStudentBalanceCoin(""); 
       setBalanceEditAmount(null); // Reset quando muda de aluno
       return; 
     }
     setStudentBalanceLoading(true);
     try {
       const resp = await axios.get(URL.studentBalance + sid);
       setStudentBalance(Number(resp.data?.sb_balance ?? 0));
       setStudentBalanceCoin(resp.data?.sb_currency || serviceCoin || "KZ");
       setBalanceEditAmount(null); // Reset ao carregar novo saldo
     } catch {
       setStudentBalance(0);
       setStudentBalanceCoin(serviceCoin || "KZ");
       setBalanceEditAmount(null);
     } finally {
       setStudentBalanceLoading(false);
     }
   }, [URL.studentBalance, serviceCoin]);
 
   // ── CARREGAR REGISTO PARA EDIÇÃO ──────────────────────────────────────────
   async function loadRecordForUpdate() {
     try {
       setFounded(null);
       const resp = await axios.get(URL.getRecord);
       const data = resp?.data || [];
       if (!data?.length) { setFounded(false); return; }
       setFounded(true);
       const row = data[0];
 
       try {
         const fx = await axios.get(URL.listFilesByCode + row.ed_fee_payment_code);
         if (fx?.data?.length) setCurrentFiles(fx.data);
       } catch {}
 
       setCurrentMonth(row.ed_fee_payment_month);
       setCurrentService(row.ed_fee_payment_service);
       setCurrentAcademicYear(row.ed_fee_payment_academic_year);
       setCurrentPaymentMethod(row.ed_fee_payment_type);
       setPaymentType(row.ed_fee_payment_type * 1 !== 0 ? 1 : 0);
       setStudentCode(row.ed_fee_payment_student);
       setServiceCode(row.ed_fee_payment_service);
 
       setField("feepayment_place",            row.ed_fee_payment_place    || "");
       setField("feepayment_bordereux_number", row.ed_fee_payment_bordereux || "");
       setField("feepayment_bank",             row.ed_fee_payment_bank     || "");
       setField("feepayment_type",             row.ed_fee_payment_type);
       setField("feepayment_months",           String(row.ed_fee_payment_month));
 
       await prepareMonths(row.ed_fee_payment_student);
       await loadServiceData(row.ed_fee_payment_service, 1, row.ed_fee_payment_student);
       await fetchStudentBalance(row.ed_fee_payment_student);
     } catch { setFounded(false); }
   }
 
   // ── PREPARAR LISTA DE MESES DO ANO LETIVO ─────────────────────────────────
   async function prepareMonths(studentId) {
     try {
       const StudentData = await axios.get(URL.singleStudent + studentId);
       const S = StudentData?.data?.[0];
       if (!S) return;
 
       const Cls = await axios.get(URL.singleClass + S.ed_student_class);
       const C   = Cls?.data?.[0];
       if (!C) return;
 
       const AY = await axios.get(URL.singleAcademicYear + C.ed_class_year);
       const Y  = AY?.data?.[0];
       if (!Y) return;
 
       setField("feepayment_academic_year", C.ed_class_year);
       setCurrentAcademicYear(C.ed_class_year);
 
       const [y1, m1] = Y.ed_academic_year_startDate.split("-").map((v) => v * 1);
       const [y2, m2] = Y.ed_academic_year_endDate.split("-").map((v) => v * 1);
       const opts = [];
 
       const pushMonth = (m, y) =>
         opts.push({ label: `${MonthsList[m]} de ${y}`, selected: false, value: Number(`${m}.${y}`) });
 
       if (y2 - y1 === 1 && m2 <= m1) {
         for (let m = m1 - 1; m <= 11; m++) pushMonth(m, y1);
         for (let m = 0; m <= m2 - 1; m++) pushMonth(m, y2);
       } else if (y2 - y1 === 1 && m2 > m1) {
         for (let m = m1 - 1; m <= 11; m++) pushMonth(m, y1);
         for (let m = 0; m <= m2 - 1; m++) pushMonth(m, y2);
       } else {
         for (let m = m1 - 1; m <= m2 - 1; m++) pushMonth(m, y1);
       }
 
       setMonthOptions(opts);
     } catch {
       toast.error("Erro ao recolher meses do ano letivo.");
     }
   }
 
   // ── CARREGAR DADOS DO SERVIÇO ─────────────────────────────────────────────
   async function loadServiceData(svcId, amount, stCode) {
     try {
       if (!svcId || !stCode) return;
 
       const [respService, respParents] = await Promise.all([
         axios.get(URL.singleService + svcId),
         axios.get(URL.parents),
       ]);
 
       const S = respService?.data?.[0];
       if (!S) return;
 
       setServicePrice(S.ed_service_price);
       setServiceCoin(S.ed_coin_code);
       setServiceDiscount(S.ed_service_discount * 1 || 0);
       setFineData([]); setServiceFine(0); setServiceFineType(0); setApplyFine(false);
 
       try {
         const IVAresp = await axios.get(URL.instituteIVA);
         const instIVA = IVAresp?.data?.[0]?.ed_institute_iva_value * 1 || 0;
         setServiceIva(S.ed_service_iva * 1 > 0 ? instIVA : 0);
       } catch { setServiceIva(0); }
 
       try {
         const P  = respParents?.data || [];
         const st = await axios.get(URL.singleStudent + stCode);
         const ST = st?.data?.[0];
         const filtered = [];
         if (ST) {
           P.forEach((p) => {
             const arr = (p.ed_parent_students_code || "").split("|").filter(Boolean);
             if (arr.includes(ST.ed_student_code)) filtered.push(p);
           });
         }
         setParentsData(filtered);
       } catch { setParentsData([]); }
 
       recalcPreview(amount || selectedMonths.length, S);
     } catch {}
   }
 
   // ── RECALCULAR TOTAL DA FATURA ────────────────────────────────────────────
   function recalcPreview(amount, SVC) {
     const PRICE    = (SVC?.ed_service_price    ?? servicePrice)    * 1 || 0;
     const DISCOUNT = (SVC?.ed_service_discount ?? serviceDiscount) * 1 || 0;
     const IVA_ON   = (SVC?.ed_service_iva      ?? (serviceIva > 0 ? 1 : 0)) * 1;
     const IVA_PCT  = serviceIva * 1 || 0;
 
     const discountAmount     = DISCOUNT > 0 ? (PRICE * DISCOUNT) / 100 : 0;
     const priceAfterDiscount = Math.max(0, PRICE - discountAmount);
     const extrasTotal        = totalExtraServices();
     const ivaAmount          = IVA_ON ? (priceAfterDiscount * IVA_PCT) / 100 : 0;
     const lineTotal          = priceAfterDiscount + ivaAmount;
     const grand              = lineTotal * Math.max(1, amount || 1) + extrasTotal;
 
     setInvoiceValue(NumberToPrice(grand) + " " + (serviceCoin || ""));
     setBalancePreview(grand);
     setApplyDiscount(DISCOUNT > 0 ? true : false);
 
     // ✓ IMPORTANTE: Quando o total muda, garantir que balanceEditAmount não excede o novo máximo
     setBalanceEditAmount((prev) => {
       if (prev === null) return null;
       const maxUsable = Math.min(studentBalance ?? 0, grand);
       return Math.min(prev, maxUsable);
     });
   }
 
   // ── SELECIONAR ALUNO ──────────────────────────────────────────────────────
   const onSelectStudent = async (code) => {
     setStudentCode(code);
     setField("feepayment_student_code", code);
     setMonthOptions([]);
     setSelectedMonths([]);
     setInvoiceValue("0");
     setBalancePreview(0);
     setBalanceEditAmount(null); // Reset seleção de saldo
     await fetchStudentBalance(code);
     await prepareMonths(code);
     if (serviceCode) await loadServiceData(serviceCode, 1, code);
   };
 
   const onChangeMonths = (vals) => setSelectedMonths(vals);
 
   const onChangeInput = (e) => {
     const { id, value } = e.target;
     if (id === "feepayment_servicecode") {
       const v = Number(value || 0);
       setServiceCode(v);
       setField("feepayment_servicecode", v);
     } else if (id === "feepayment_type") {
       const v = Number(value);
       setPaymentType(v);
       setField("feepayment_type", v);
       // ✓ Ao ativar "Saldo do aluno", NÃO pré-definir a valor — deixar operador escolher
       if (v === PAYMENT_TYPE_BALANCE) {
         setBalanceEditAmount(null); // Começar em 0 / indefinido
       } else {
         setBalanceEditAmount(null); // Limpar se mudar para outro método
       }
     } else {
       setField(id, value);
     }
   };
 
   // ── EFFECTS ───────────────────────────────────────────────────────────────
   useEffect(() => { if (SH) handleShow(); }, [props.pop]);
 
   useEffect(() => {
     if (serviceCode && studentCode) loadServiceData(serviceCode, selectedMonths.length, studentCode);
   }, [serviceCode, studentCode, selectedMonths.length]);
 
   useEffect(() => {
     recalcPreview(selectedMonths.length);
   }, [extraServicesEnabled, extraServices]);
 
   // Prefill (pagamento rápido)
   useEffect(() => {
     if (!prefill) return;
     if (prefill.studentId) {
       const sid = String(prefill.studentId);
       setStudentCode(sid);
       setField("feepayment_student_code", sid);
       setMonthOptions([]);
       fetchStudentBalance(sid);
       prepareMonths(sid);
     }
     if (prefill.academicYearId) {
       setCurrentAcademicYear(Number(prefill.academicYearId));
       setField("feepayment_academic_year", Number(prefill.academicYearId));
     }
     if (Array.isArray(prefill.months) && prefill.months.length) {
       setSelectedMonths(prefill.months.map((m) => ({
         label: m.label || monthLabel(m.value),
         value: Number(m.value),
       })));
     }
   }, [prefill?.studentId, prefill?.academicYearId]);
 
   useEffect(() => {
     if (serviceCoin && !studentBalanceCoin) setStudentBalanceCoin(serviceCoin);
   }, [serviceCoin]);
 
   // ── COMPUTED ──────────────────────────────────────────────────────────────
   const usingBalance = paymentType === PAYMENT_TYPE_BALANCE;
 
   // ✓ NOVO: Valor efetivo de créditos a usar
   // Se balanceEditAmount está definido, usa esse valor (até ao máximo)
   // Se não, começa em 0 (operador precisa escolher deliberadamente)
   const effectiveBalanceUsed = useMemo(() => {
     if (!usingBalance || studentBalance === null) return 0;
     if (balanceEditAmount === null) return 0; // Nenhum saldo selecionado
     return Math.min(balanceEditAmount, studentBalance, balancePreview > 0 ? Infinity : 0);
   }, [usingBalance, studentBalance, balanceEditAmount, balancePreview]);
 
   // ── SUBMISSÃO ─────────────────────────────────────────────────────────────
   const FormSubmit = async (e) => {
     e.preventDefault();
     try {
       setRegisterStatus(0);
       balanceDeductedRef.current = false;
 
       const fv = {};
       if (!studentCode) fv.feepayment_student_code = "Selecione um estudante";
       if (!serviceCode || serviceCode <= 0) fv.feepayment_servicecode = "Selecione o valor associado à propina";
 
       const monthsToSend = props.update
         ? [String(form.feepayment_months || currentMonth)]
         : selectedMonths.map((m) => String(m.value));
 
       if (!monthsToSend.length) fv.feepayment_months = "Selecione os meses a pagar";
       if (paymentType === null || paymentType === undefined)
         fv.feepayment_type = "Selecione o método de pagamento";
 
       // ✓ Validação de saldo: só falha se operador tenta usar MAIS do que tem
       if (usingBalance) {
         if (studentBalance === null)
           fv.feepayment_type = "Saldo não disponível. Tente novamente.";
         else if ((balanceEditAmount ?? 0) > studentBalance)
           fv.feepayment_type = `Não pode usar mais do que o saldo disponível (${fmtMoney(studentBalance, studentBalanceCoin)})`;
       }
 
       if (Object.keys(fv).length) {
         setErrors(fv);
         setRegisterStatus(1);
         toast.error("Verifique os campos obrigatórios.");
         return;
       }
 
       const items = monthsToSend.map((m) => ({
         serviceId:   serviceCode,
         month:       m,
         price:       servicePrice,
         discountPct: serviceDiscount || 0,
         fineType:    0,
         fineValue:   0,
         applyIVA:    serviceIva > 0 ? 1 : 0,
       }));
 
       const extraServicesPayload = (extraServicesEnabled ? extraServices : [])
         .filter((it) => (it?.name || "").trim() !== "" && String(it?.value).trim() !== "")
         .map((it) => ({
           name:  String(it.name).trim(),
           value: Number(String(it.value).replace(",", ".")) || 0,
         }));
 
       // ✓ NOVO: Calcular créditos a usar
       // Se operador escolheu um valor específico (balanceEditAmount !== null), usa esse
       // Caso contrário, usa 0 (sem saldo)
       const balanceUsed = usingBalance && balanceEditAmount !== null
         ? Number(Math.min(balanceEditAmount, studentBalance ?? 0, balancePreview).toFixed(2))
         : 0;
 
       const payload = {
         studentId:      Number(studentCode),
         academicYearId: Number(form.feepayment_academic_year || currentAcademicYear),
         paymentType:    Number(paymentType),
         bankName:       form.feepayment_bank   || "",
         paymentPlace:   form.feepayment_place  || "",
         bordereux:      form.feepayment_bordereux_number || "",
         items,
         extraServices:  extraServicesPayload,
         // ✓ NOVO: Enviar valor PARCIAL de saldo aplicado
         balanceUsed,
       };
 
       const res = await axios.post(URL.batchRegister, payload);
       if (!res?.data?.success) throw new Error(res?.data?.msg || "Falha no registo.");
 
       const invNumber = res.data?.invoice?.number;
       const remaining = res.data?.remaining ?? Math.max(0, balancePreview - balanceUsed);
 
       // Sucesso — limpar formulário
       toast.success(
         balanceUsed > 0 
           ? `Pagamento registado! Saldo usado: ${fmtMoney(balanceUsed, studentBalanceCoin || serviceCoin)}. Restante: ${fmtMoney(remaining, studentBalanceCoin || serviceCoin)}`
           : "Pagamento registado com sucesso!"
       );
 
       RefreshList(`.el-refresh-list_${studentCode}`);
       RefreshList(`.el-refresh-list`);
 
       setRegisterStatus(2);
       setForm({});
       ChildRef.current?.ClearFiles?.();
       setSelectedMonths([]);
       setInvoiceValue("0 " + (serviceCoin || ""));
       setBalancePreview(0);
       setNonePaidMonths(0);
       setFiles([]);
       setExtraServicesEnabled(false);
       setExtraServices([]);
       setBalanceEditAmount(null);
       
       // Atualizar saldo local se foi utilizado
       if (balanceUsed > 0 && studentBalance !== null) {
         setStudentBalance(Number((studentBalance - balanceUsed).toFixed(2)));
       }
 
       if (props.update) setTimeout(handleClose, 400);
       else handleClose();
     } catch (err) {
       setRegisterStatus(1);
       toast.error(String(err?.response?.data?.msg || err?.message || "Erro desconhecido"));
     }
   };
 
   const studentsList = StudentsArray();
   const lockStudent  = !!prefill?.lockStudent;
   const lockMonths   = !!prefill?.lockMonths;
 
   // ── RENDER ────────────────────────────────────────────────────────────────
   return (
     <div>
       <div onClick={handleShow}>
         {props.toggle_btn ? props.toggle_btn : (
           <button className="btn btn-main bg-main">
             <AddCircleOutlineIcon /> Efetuar pagamento de propina
           </button>
         )}
       </div>
 
       <AnimatedModal content={
         <Modal
           size="lg"
           className={showBox ? ModalAnimationShow() : ModalAnimationClose()}
           centered dialogAs={DraggableModal} show={show} onHide={handleClose}
         >
           <Modal.Header closeButton>
             <Modal.Title>
               <div className="ed-wrap align-center">
                 <UserOptionDropDown />
                 <h5>{props.title ? props.title : "Efetuar "} pagamento de propina</h5>
               </div>
             </Modal.Title>
           </Modal.Header>
 
           <Form onSubmit={FormSubmit}>
             <Modal.Body className="scrollLimit">
               <Alert variant="info">
                 <small>
                   Pode selecionar vários meses/serviços; o sistema emite{" "}
                   <strong>uma única fatura</strong> contendo todas as linhas.
                   Cada linha respeita desconto/IVA conforme a regra do serviço.
                   Para multas ou outros acréscimos use a secção de{" "}
                   <strong>valores adicionais</strong> abaixo.
                 </small>
               </Alert>
 
               {/* ── ALUNO ── */}
               {!props.update && (
                 <Form.Group className="mb-3">
                   <div className="ed-space">
                     <div>
                       <Form.Label>
                         Nome do estudante <span className="text-danger ml-2">*</span>
                       </Form.Label>
                     </div>
                     <div className="ed-flex" style={{ gap: 8, alignItems: "center" }}>
                       {/* Badge de saldo — visível logo que aluno é selecionado */}
                       {studentCode && (
                         <BalanceBadge
                           balance={studentBalance}
                           currency={studentBalanceCoin || serviceCoin}
                           loading={studentBalanceLoading}
                         />
                       )}
                       {/* Botão de carregar saldo */}
                       {studentCode && (studentBalance === 0 || (studentBalance !== null && balancePreview > studentBalance)) && (
                         <button
                           type="button"
                           title="Carregar saldo para este aluno"
                           onClick={() => setShowBalanceCanvas(true)}
                           style={{
                             display: "inline-flex", alignItems: "center", gap: 4,
                             padding: "2px 8px", borderRadius: 20, fontSize: 11, fontWeight: 600,
                             background: "#f5f3ff", color: "#7c3aed", border: "1px solid #ede9fe",
                             cursor: "pointer",
                           }}
                         >
                           <IoWalletOutline size={12} /> Carregar saldo
                         </button>
                       )}
                       {studentCode && (
                         <StudentDetailsMenu
                           student_id={studentCode}
                           toggle_btn={<div className="btn-pm-info"><InfoOutlined /></div>}
                         />
                       )}
                     </div>
                   </div>
 
                   {lockStudent ? (
                     <div className="grey-text" style={{ fontSize: 13 }}>
                       Estudante selecionado automaticamente.
                     </div>
                   ) : (
                     <>
                       <div className={`select-search-item ${errors.feepayment_student_code ? "error" : ""}`}>
                         <SelectSearch
                           onChange={onSelectStudent}
                           value={studentCode}
                           options={studentsList}
                           search
                           placeholder="Selecione um aluno"
                         />
                       </div>
                       <small className="text-danger">{errors.feepayment_student_code}</small>
                     </>
                   )}
                 </Form.Group>
               )}
 
               {/* ── MESES ── */}
               {!props.update ? (
                 monthOptions.length ? (
                   <Form.Group className="mb-3">
                     <Form.Label>
                       Mês(es) a pagar <span className="text-danger ml-2">*</span>
                     </Form.Label>
                     {lockMonths ? (
                       <div className="grey-text" style={{ fontSize: 13 }}>
                         Meses selecionados:{" "}
                         <span className="text-main">
                           {selectedMonths.map((m) => m.label).join(", ")}
                         </span>
                       </div>
                     ) : (
                       <>
                         <MultiSelect
                           options={monthOptions}
                           value={selectedMonths}
                           className={errors.feepayment_months ? "border-red" : ""}
                           onChange={onChangeMonths}
                           labelledBy="select"
                         />
                         {errors.feepayment_months && (
                           <small className="text-danger">{errors.feepayment_months}</small>
                         )}
                       </>
                     )}
                   </Form.Group>
                 ) : null
               ) : (
                 <Form.Group className="mb-3">
                   <Form.Label>
                     Mês a pagar <span className="text-danger ml-2">*</span>
                   </Form.Label>
                   <Form.Select
                     disabled
                     id="feepayment_months"
                     value={form.feepayment_months || currentMonth || ""}
                   >
                     {monthOptions.map((m, i) => (
                       <option key={i} value={m.value}
                         selected={Number(m.value) === Number(currentMonth)}>
                         {m.label}
                       </option>
                     ))}
                   </Form.Select>
                 </Form.Group>
               )}
 
               {/* ── VALOR ASSOCIADO À PROPINA ── */}
               <Form.Group className="mb-3">
                 <Form.Label>
                   Valor associado à propina <span className="text-danger ml-2">*</span>
                 </Form.Label>
                 <Form.Select
                   onChange={onChangeInput}
                   className={!!errors.feepayment_servicecode && "is-invalid"}
                   value={serviceCode || ""}
                   isInvalid={!!errors.feepayment_servicecode}
                   id="feepayment_servicecode"
                 >
                   {props.update
                     ? <ServiceDataOptions code={currentService} />
                     : <ServiceDataOptions />}
                 </Form.Select>
                 <Form.Control.Feedback type="invalid">
                   {errors.feepayment_servicecode}
                 </Form.Control.Feedback>
 
                 {serviceCode != null && (
                   <div className="mt-2">
                     <Badge className="bg-main">
                       <div className="ed-flex">
                         Valor do serviço:
                         <div className="ml-1"><GetServicePrice ID={serviceCode} /></div>
                       </div>
                     </Badge>
                   </div>
                 )}
               </Form.Group>
 
               {/* ── VALORES ADICIONAIS ── */}
               <div className="mt-2">
                 <FormControlLabel
                   control={
                     <Checkbox
                       checked={extraServicesEnabled}
                       onChange={(e) => setExtraServicesEnabled(e.target.checked)}
                     />
                   }
                   label="Adicionar valores adicionais (ex: multa)"
                 />
               </div>
 
               {extraServicesEnabled && (
                 <BoxContainerBorder className="boxItem">
                   <h2 className="title">Valores adicionais</h2>
                   {extraServices.length === 0 && (
                     <div className="mb-3">
                       <small className="grey-text">
                         Sem itens. Clique em <strong>"+ Adicionar"</strong> para criar uma linha.
                       </small>
                     </div>
                   )}
                   {extraServices.map((it, idx) => (
                     <div key={idx} className="ed-space mb-2">
                       <div className="ed-flex" style={{ gap: 10, flex: 1 }}>
                         <Form.Control
                           type="text"
                           placeholder="Nome (ex: Multa de atraso)"
                           value={it.name}
                           onChange={(e) => updateExtraService(idx, "name", e.target.value)}
                         />
                         <Form.Control
                           type="number" step="0.01" min="0"
                           placeholder={`Valor (${serviceCoin || "KZ"})`}
                           value={it.value}
                           onChange={(e) => updateExtraService(idx, "value", e.target.value)}
                           style={{ maxWidth: 180 }}
                         />
                       </div>
                       <div onClick={() => removeExtraService(idx)} className="bg-red btn ml-2">
                         <DeleteOutline fontSize="small" /> Remover
                       </div>
                     </div>
                   ))}
                   <div className="mt-3">
                     <div className="btn btn-bordered bg-main text-main" onClick={addExtraService}>
                       <AddCircleOutlineIcon fontSize="small" /> Adicionar
                     </div>
                   </div>
                 </BoxContainerBorder>
               )}
 
               {/* ── MÉTODO DE PAGAMENTO ── */}
               <Form.Group>
                 <div className="mt-2">
                   <div className="block">
                     <Form.Label>
                       Método de pagamento <span className="text-danger ml-2">*</span>
                     </Form.Label>
                     <Form.Select
                       onChange={onChangeInput}
                       className={!!errors.feepayment_type && "is-invalid"}
                       value={paymentType ?? ""}
                       isInvalid={!!errors.feepayment_type}
                       id="feepayment_type"
                       required
                     >
                       <option disabled value="">Selecionar método de pagamento...</option>
                       <option value="0"  selected={currentPaymentMethod === 0}>Dinheiro a mão</option>
                       <option value="1"  selected={currentPaymentMethod === 1}>Transferência</option>
                       <option value="2"  selected={currentPaymentMethod === 2}>Depósito</option>
                       <option value="3"  selected={currentPaymentMethod === 3}>TPA</option>
                       <option
                         value={PAYMENT_TYPE_BALANCE}
                         disabled={!studentCode || studentBalance === null}
                         selected={currentPaymentMethod === PAYMENT_TYPE_BALANCE}
                       >
                         Saldo do aluno{studentBalance !== null ? ` (${fmtMoney(studentBalance, studentBalanceCoin)})` : ""}
                       </option>
                     </Form.Select>
                     <Form.Control.Feedback type="invalid">
                       {errors.feepayment_type}
                     </Form.Control.Feedback>
                   </div>
 
                   {/* ✓ SELETOR DE CRÉDITOS PARCIAIS — NOVO ── */}
                   {usingBalance && studentCode && studentBalance !== null && (
                     <BalanceCreditSelector
                       balance={studentBalance}
                       total={balancePreview}
                       coin={studentBalanceCoin || serviceCoin}
                       editAmount={balanceEditAmount}
                       onChange={(v) => setBalanceEditAmount(v)}
                     />
                   )}
 
                   {/* Campos de referência (transferência/depósito/TPA) */}
                   {paymentType !== null && paymentType !== 0 && paymentType !== PAYMENT_TYPE_BALANCE && (
                     <div className="block mt-3">
                       <Form.Label>Nº de Referência</Form.Label>
                       <Form.Control
                         type="text" onChange={onChangeInput}
                         className={!!errors.feepayment_bordereux_number && "is-invalid"}
                         value={form.feepayment_bordereux_number || ""}
                         isInvalid={!!errors.feepayment_bordereux_number}
                         id="feepayment_bordereux_number"
                       />
                       <Form.Control.Feedback type="invalid">
                         {errors.feepayment_bordereux_number}
                       </Form.Control.Feedback>
 
                       <div className="block mt-3">
                         <Form.Label>Nome do banco</Form.Label>
                         <Form.Control
                           type="text" onChange={onChangeInput}
                           className={!!errors.feepayment_bank && "is-invalid"}
                           value={form.feepayment_bank || ""}
                           isInvalid={!!errors.feepayment_bank}
                           id="feepayment_bank"
                         />
                         <Form.Control.Feedback type="invalid">
                           {errors.feepayment_bank}
                         </Form.Control.Feedback>
                       </div>
 
                       <div className="block mt-3">
                         <Form.Label>Local de pagamento</Form.Label>
                         <Form.Control
                           type="text" onChange={onChangeInput}
                           className={!!errors.feepayment_place && "is-invalid"}
                           value={form.feepayment_place || ""}
                           isInvalid={!!errors.feepayment_place}
                           id="feepayment_place"
                         />
                         <Form.Control.Feedback type="invalid">
                           {errors.feepayment_place}
                         </Form.Control.Feedback>
                       </div>
                     </div>
                   )}
                 </div>
               </Form.Group>
 
               {/* ── FICHEIROS ANEXADOS ── */}
               {currentFiles.length > 0 && (
                 <BoxContainerBorder className="boxItem mt-4">
                   <h2 className="title">Ficheiros anexados</h2>
                   <ul className="student-file-cp">
                     {currentFiles.map((item, index) => (
                       <li className="student-file-el" id={`student-file-el-${index}`} key={index}>
                         <div className="ed-space">
                           <div className="ed-flex">
                             <div className="icon"><HiOutlineDocumentText /></div>
                             <div className="block">
                               <div className="title text-main">
                                 <ReduceTextLength
                                   text={item.ed_file_name}
                                   length={window?.width >= 1300 ? 80 : 50}
                                 />
                               </div>
                               <div className="ed-flex">
                                 <div className="date text-dark">
                                   <AccessTimeOutlined />
                                   <span>{item.ed_file_register_date}</span>
                                 </div>
                                 | <div className="size text-dark">{NumberToBytes(item.ed_file_size)}</div>
                               </div>
                             </div>
                           </div>
                           <div className="delete">
                             <DeleteModal
                               remove_element={`#student-file-el-${index}`}
                               title="este ficheiro"
                               url={Hoot() + `eduallfiledelete/delete/${item.ed_file_id}`}
                               message="Ficheiro deletado com sucesso"
                               toggle_btn={
                                 <div className="btn-circle bg-danger ml-2 text-light">
                                   <DeleteOutline />
                                 </div>
                               }
                             />
                           </div>
                         </div>
                       </li>
                     ))}
                   </ul>
                 </BoxContainerBorder>
               )}
 
               <div className="mt-2">
                 <FormControlLabel
                   onChange={showBoxFile}
                   control={<Checkbox />}
                   label="Anexar recibos de pagamento"
                 />
               </div>
 
               <BoxContainerBorder className={docfile ? "boxItem" : "boxItem d-none"}>
                 <h2 className="title">Carregar Recibo de pagamento</h2>
                 <FileUpload
                   input_name="feepayment_files"
                   Icon="0"
                   type_of_files="image/x-png,image/gif,image/jpeg,Docs/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/pdf"
                   extensions="pdf, docx, png, jpeg, jpg"
                   Files={GetFiles}
                   ref={ChildRef}
                 />
               </BoxContainerBorder>
               {docfile && <br />}
             </Modal.Body>
 
             {/* ── FOOTER ── */}
             <Modal.Footer>
               <div className="ed-space">
                 <div className="ed-wrap">
                   <TX className="mt-1">
                     <h4>Desconto : ({serviceDiscount})%</h4>
                     {applyDiscount
                       ? <div className="yes"><Check /></div>
                       : <div className="no"><Close /></div>}
                   </TX>
                   <TX className="mt-1 d-none">
                     <h4 className="ml-2">
                       Multa : ({serviceFine} {serviceFineType === 1 ? serviceCoin : ""}{" "}
                       {nonePaidMonths <= 1 ? "" : " * " + nonePaidMonths})
                       {serviceFineType === 0 ? "%" : <span className="text-red"> Valor fixo</span>}
                     </h4>
                     {applyFine
                       ? <div className="yes"><Check /></div>
                       : <div className="no"><Close /></div>}
                   </TX>
                   <TX className="mt-1">
                     <h4 className="ml-2">IVA : ({serviceIva})%</h4>
                     {serviceIva * 1 > 0
                       ? <div className="yes"><Check /></div>
                       : <div className="no"><Close /></div>}
                   </TX>
                 </div>
               </div>
 
               {/* ── LINHA DE SALDO NO FOOTER ── */}
               {studentCode && studentBalance !== null && (
                 <BalanceFooterRow>
                   <IoWalletOutline size={15} />
                   <span>Saldo do aluno:</span>
                   <strong style={{ color: Number(studentBalance) < 500 ? "#e21f1f" : "var(--ed-green-light, #15803d)" }}>
                     {fmtMoney(studentBalance, studentBalanceCoin || serviceCoin)}
                   </strong>
                   {usingBalance && balanceEditAmount !== null && balanceEditAmount > 0 && balanceEditAmount < studentBalance && (
                     <span style={{ fontSize: 11, color: "#7c3aed", opacity: .8 }}>
                       (usando {fmtMoney(balanceEditAmount, studentBalanceCoin || serviceCoin)})
                     </span>
                   )}
                   {usingBalance && balancePreview > 0 && balanceEditAmount !== null && (balanceEditAmount > 0) && (
                     <>
                       <span style={{ opacity: .5 }}>→</span>
                       <strong style={{ color: "var(--ed-green-light, #15803d)" }}>
                         {fmtMoney(
                           Number(studentBalance) - balanceEditAmount,
                           studentBalanceCoin || serviceCoin
                         )}
                       </strong>
                     </>
                   )}
                 </BalanceFooterRow>
               )}
 
               <div className="ed-space">
                 <div className="ed-flex">
                   <h5 className="m-0">Total :</h5>
                   <Form.Control
                     readOnly disabled
                     value={invoiceValue}
                     id="feepayment_balance"
                     className="text-danger ml-2"
                     style={{ maxWidth: "210px" }}
                   />
                 </div>
                 <div className="ed-flex">
                   <Button className="bg-light text-dark" onClick={handleClose}>
                     Cancelar
                   </Button>
                   <SaveButton
                     icon={props.title ? <Update /> : <MonetizationOn />}
                     title={props.title ? props.title : "Pagar"}
                     status={registerStatus}
                     disabled={usingBalance && studentBalance !== null && (balanceEditAmount ?? 0) > studentBalance}
                   />
                 </div>
               </div>
             </Modal.Footer>
           </Form>
         </Modal>
       } />
 
       {/* ── OFFCANVAS DE SALDO ── */}
       {studentCode && (
         <StudentBalanceModal
           mode="modal"
           canvas={true}
           show={showBalanceCanvas}
           onHide={() => {
             setShowBalanceCanvas(false);
             fetchStudentBalance(studentCode);
           }}
           studentId={studentCode}
           currency={studentBalanceCoin || serviceCoin || "KZ"}
         />
       )}
     </div>
   );
 }
 
 // ─── STYLED COMPONENTS ─────────────────────────────────────────────────────
 
 const TX = styled.div`
   display: flex;
   align-items: center;
   margin-right: 20px;
 
   .yes svg { width: 20px; height: 20px; fill: var(--ed-green); margin: 0; }
   .no  svg { width: 20px; height: 20px; fill: var(--ed-red); }
   h4 { font-size: 16px; margin: 0 5px 0 0; font-weight: 600; }
 `;
 
 const BoxContainerBorder = styled.div`
   width: auto;
   border-radius: 6px;
   margin: 10px 0;
   padding: 20px;
   min-height: 200px;
   background: var(--ed-white);
   border: 1px solid var(--ed-silver-light);
 
   h2.title {
     font-size: 18px;
     text-transform: uppercase;
     font-weight: 600;
     margin-top: 10px;
     margin-bottom: 25px;
   }
 `;
 
 const BalanceFooterRow = styled.div`
   display: flex;
   align-items: center;
   gap: 6px;
   font-size: 13px;
   color: var(--ed-dark);
   background: #f5f3ff;
   border: 1px solid #ede9fe;
   border-radius: 8px;
   padding: 6px 12px;
   margin-bottom: 8px;
   width: 100%;
 
   svg { color: #7c3aed; flex-shrink: 0; }
   span { color: #555; }
   strong { font-weight: 700; }
 `;
 
 const CreditSelectorBox = styled.div`
   background: #f5f3ff;
   border: 1px solid #ede9fe;
   border-radius: 10px;
   padding: 14px 16px;
   margin-top: 10px;
 
   .cs-header {
     display: flex;
     justify-content: space-between;
     align-items: center;
     margin-bottom: 10px;
   }
 
   .cs-title {
     display: flex;
     align-items: center;
     gap: 6px;
     font-size: 12px;
     font-weight: 700;
     color: #7c3aed;
     text-transform: uppercase;
     letter-spacing: 0.4px;
   }
 
   .cs-available {
     font-size: 11px;
     color: #888;
     strong { color: #333; }
   }
 
   .cs-slider {
     width: 100%;
     accent-color: #7c3aed;
     margin-bottom: 8px;
     cursor: pointer;
   }
 
   .cs-input-row {
     display: flex;
     align-items: center;
     gap: 10px;
     margin-bottom: 12px;
     flex-wrap: wrap;
   }
 
   .cs-input-wrap {
     display: flex;
     align-items: center;
     gap: 6px;
     background: #fff;
     border: 1.5px solid #c4b5fd;
     border-radius: 8px;
     padding: 4px 10px;
   }
 
   .cs-input {
     width: 120px;
     border: none;
     outline: none;
     font-size: 15px;
     font-weight: 800;
     color: #7c3aed;
     background: transparent;
     &::-webkit-inner-spin-button,
     &::-webkit-outer-spin-button { opacity: 0.4; }
   }
 
   .cs-coin {
     font-size: 11px;
     color: #7c3aed;
     font-weight: 600;
     opacity: 0.7;
   }
 
   .cs-quick-btns {
     display: flex;
     gap: 5px;
     flex-wrap: wrap;
   }
 
   .cs-btn {
     font-size: 11px;
     padding: 4px 11px;
     border-radius: 20px;
     border: none;
     cursor: pointer;
     font-weight: 600;
     transition: opacity 0.15s;
     &:hover { opacity: 0.8; }
   }
 
   .cs-btn-all  { background: #7c3aed; color: #fff; }
   .cs-btn-half { background: #ede9fe; color: #7c3aed; }
   .cs-btn-none { background: #f1f5f9; color: #64748b; }
 
   .cs-summary {
     display: grid;
     grid-template-columns: 1fr auto 1fr auto 1fr;
     align-items: center;
     border-radius: 8px;
     padding: 10px 12px;
     gap: 0;
 
     &--ok      { background: #f0fdf4; border: 1px solid #86efac; }
     &--partial { background: #fffbeb; border: 1px solid #fde68a; }
   }
 
   .cs-summary-item {
     text-align: center;
   }
 
   .cs-summary-divider {
     width: 1px;
     height: 32px;
     background: rgba(0,0,0,0.08);
     margin: 0 8px;
   }
 
   .cs-summary-label {
     font-size: 10px;
     color: #888;
     margin-bottom: 3px;
     white-space: nowrap;
   }
 
   .cs-summary-value {
     font-size: 13px;
     font-weight: 800;
     display: flex;
     align-items: center;
     justify-content: center;
     gap: 3px;
   }
 
   .cs-purple { color: #7c3aed; }
   .cs-green  { color: #15803d; }
   .cs-red    { color: #e21f1f; }
   .cs-orange { color: #d97706; }
 
   .cs-warning {
     font-size: 11px;
     color: #b45309;
     background: #fef3c7;
     border: 1px solid #fde68a;
     border-radius: 6px;
     padding: 6px 10px;
     margin-top: 8px;
     strong { font-weight: 700; }
   }
 
   .cs-info {
     font-size: 11px;
     color: #0369a1;
     background: #e0f2fe;
     border: 1px solid #bae6fd;
     border-radius: 6px;
     padding: 6px 10px;
     margin-top: 8px;
   }
 
   .cs-success {
     font-size: 11px;
     color: #15803d;
     background: #f0fdf4;
     border: 1px solid #86efac;
     border-radius: 6px;
     padding: 6px 10px;
     margin-top: 8px;
     font-weight: 600;
   }
 `;
 
 export default NewfeeManualPaymentModal;




 import React, { useEffect, useRef, useState, useMemo } from 'react'
 import styled from 'styled-components'
 import { Button, Form, Alert as BsAlert } from 'react-bootstrap'
 import { InfoOutlined, Search, Close } from '@mui/icons-material';
 import { Avatar, Checkbox as MuiCheckbox } from '@mui/material';
 import { Link } from 'react-router-dom';
 import SmallStudentsGrid from '../../components/Grid/SmallStudentsGrid';
 import FeespaymentsTable from '../../components/Table/FeespaymentsTable';
 import NewfeeManualPaymentModal from '../../components/modal/NewfeeManualPaymentModal';
 import { AcademicYearDataOptions } from '../../../General/components/InstituteData';
 import axios from 'axios';
 import Hoot from '../../../General/components/Hoot';
 import EmptyImage from '../../../Assets/images/svg/personal_info.svg';
 import SwitchFromPages from '../../../General/components/SwitchFromPages';
 import Loader from '../../../General/components/Loader';
 import StudentDetailsMenu from '../../components/elements/StudentDetailsMenu';
 import NotFounded from '../../../General/components/NotFounded';
 import KeyboardEventHandler from 'react-keyboard-event-handler';
 import { useLocation, useHistory } from 'react-router-dom';
 import ReplaceWord from '../../../General/components/ReplaceWord';
 import { RiRfidLine, RiBankCardLine } from "react-icons/ri";
 
 function FeesPayments() {
   document.title = "Pagar Propinas";
 
   const ChildRef = useRef();
   const navigate = useHistory();
   const { search } = useLocation();
   const searchParams = new URLSearchParams(search);
 
   const YearParam = searchParams.get("year");
   const StudentParam = searchParams.get("student");
 
   const [StudentName, setStudentName] = useState('#');
   const [StudentDataInfo, setStudentDataInfo] = useState({});
   const [StudentPicture, setStudentPicture] = useState('#');
   const [StudentId, setStudentId] = useState('#');
 
   const [AcademicYear, setAcademicyear] = useState(null);
 
   const [ShowMonths, setShowMonths] = useState(false);
   const [StudentClassFilter, setStudentClassFilter] = useState(null);
   const [StudentNameFilter, setStudentNameFilter] = useState(null);
 
   const [PopStatus, setPopStatus] = useState(false);
 
   const [MP, SM] = useState([]);
   const [Founded, setFounded] = useState('');
 
   // ====== AUTO RFID SCAN ======
   const rfidInputRef = useRef(null);
 
   const [rfidStatus, setRfidStatus] = useState("active");
   const [rfidAlert, setRfidAlert] = useState({
     show: true,
     type: "info",
     msg: "Pode encostar o cartão RFID do aluno para carregar automaticamente os dados e pagamentos do ano lectivo atual."
   });
   const [rfidError, setRfidError] = useState(null);
 
   // buffer global (funciona mesmo sem foco no input invisível)
   const rfidBufferRef = useRef("");
   const rfidBufferTimerRef = useRef(null);
 
   // ===== Pagamento rápido (seleção de meses) =====
   const [selectedMonthsQuick, setSelectedMonthsQuick] = useState([]); // {label,value}
   const [quickPayOpen, setQuickPayOpen] = useState(false);
 
   const normalizeId = (v) => {
     const n = Number(v);
     return Number.isFinite(n) && n > 0 ? n : 0;
   };
 
   const goToStudentYear = (studentId, year) => {
     navigate.push(`/feespayments?student=0&year=0`);
     navigate.push(`/feespayments?student=${studentId}&year=${year}`);
   };
 
   const FilterPaymentByYear = (e) => {
     const year = e.target.value;
     setAcademicyear(normalizeId(year) || null);
 
     if (!StudentId || StudentId === "#" || normalizeId(StudentId) <= 0) {
       navigate.push(`/feespayments?student=0&year=${year}`);
       return;
     }
     goToStudentYear(StudentId, year);
   };
 
   const GetStudentPaymentData = (studentId, year) => {
     setAcademicyear(normalizeId(year) || null);
     goToStudentYear(studentId, year);
   };
 
   const GetPaymentDataByStudentId = async (studentId, academicYear) => {
     const sid = normalizeId(studentId);
     const year = normalizeId(academicYear);
 
     if (!sid || !year) {
       setFounded(false);
       return;
     }
 
     try {
       setFounded(null);
 
       const url = `${Hoot()}eduallfeepayments/get/student/${sid}?ano=${year}`;
       const response = await axios.get(url, { withCredentials: true });
 
       if (response?.data?.success && response.data.data) {
         const { student, months } = response.data.data;
 
         if (student) {
           setStudentDataInfo(student);
           setStudentName(student.name || "#");
           setStudentPicture(student.picture || "#");
           setStudentId(student.id || sid);
           if (student.academic_year) setAcademicyear(student.academic_year);
         }
 
         if (Array.isArray(months) && months.length > 0) {
           SM(months);
           setShowMonths(true);
           setFounded(true);
         } else {
           SM([]);
           setShowMonths(false);
           setFounded(false);
         }
       } else {
         setFounded(false);
       }
     } catch (error) {
       setFounded(false);
     }
   };
 
   const GetPaymentDataByRFID = async (rfidCode) => {
     const code = (rfidCode || "").trim();
     if (!code) return;
 
     try {
       setFounded(null);
       setRfidStatus("reading");
       setRfidError(null);
 
       // log (opcional)
       try {
         await axios.post(`${Hoot()}eduallrfid/log/register`, { code }, { withCredentials: true });
       } catch (_) {}
 
       const url = `${Hoot()}eduallfeepayments/get/student/rfid/${encodeURIComponent(code)}`;
       const response = await axios.get(url, { withCredentials: true });
 
       if (response?.data?.success && response.data.data) {
         const { student, months } = response.data.data;
 
         if (student) {
           setStudentDataInfo(student);
           setStudentName(student.name || "#");
           setStudentPicture(student.picture || "#");
           setStudentId(student.id || "#");
 
           if (student.academic_year) {
             setAcademicyear(student.academic_year);
             goToStudentYear(student.id, student.academic_year);
           }
         }
 
         if (Array.isArray(months) && months.length > 0) {
           SM(months);
           setShowMonths(true);
           setFounded(true);
         } else {
           SM([]);
           setShowMonths(false);
           setFounded(false);
         }
 
         setRfidStatus("active");
         return;
       }
 
       setFounded(false);
       setRfidStatus("active");
     } catch (error) {
       setFounded(false);
       setRfidStatus("active");
       setRfidError(error?.response?.data?.message || error?.message || "Erro ao processar cartão RFID.");
     }
   };
 
   // carregar por params
   useEffect(() => {
     const year = normalizeId(YearParam);
     const studentId = normalizeId(StudentParam);
 
     if (year) setAcademicyear(year);
 
     if (studentId && year) {
       GetPaymentDataByStudentId(studentId, year);
     }
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [YearParam, StudentParam]);
 
   // reset seleção ao trocar aluno/ano
   useEffect(() => {
     setSelectedMonthsQuick([]);
     setQuickPayOpen(false);
   }, [StudentId, AcademicYear]);
 
   const focusRFID = () => {
     try {
       rfidInputRef.current?.focus();
     } catch {}
   };
 
   //  RFID robusto:
   // 1) Mantém foco no input invisível quando não estás a interagir com inputs/selects/modais
   // 2) Também captura teclas globalmente (funciona mesmo se o foco fugir)
   useEffect(() => {
     const isTypingTarget = (el) => {
       if (!el) return false;
       const tag = (el.tagName || "").toLowerCase();
       if (tag === "input" || tag === "textarea" || tag === "select") return true;
       // react-select-search / multi-select / listbox / modals
       if (el.closest?.('.modal')) return true;
       if (el.closest?.('.select-search')) return true;
       if (el.closest?.('.select-search-container')) return true;
       if (el.closest?.('.rmsc')) return true;
       if (el.closest?.('[role="listbox"]')) return true;
       if (el.closest?.('[role="dialog"]')) return true;
       return false;
     };
 
     const tryAutoFocus = () => {
       const active = document.activeElement;
       // se estás a escrever noutro input/select, não roubar foco
       if (isTypingTarget(active)) return;
       focusRFID();
     };
 
     // foco inicial + manutenção suave
     tryAutoFocus();
     const t = setInterval(tryAutoFocus, 1200);
 
     // ao clicar fora de campos, voltar a focar
     const onGlobalPointerDown = (e) => {
       if (!isTypingTarget(e.target)) focusRFID();
     };
     window.addEventListener("pointerdown", onGlobalPointerDown, true);
 
     // captura global do scanner (mais confiável que depender do foco)
     const clearBufferSoon = () => {
       if (rfidBufferTimerRef.current) clearTimeout(rfidBufferTimerRef.current);
       rfidBufferTimerRef.current = setTimeout(() => {
         rfidBufferRef.current = "";
       }, 350); // scanner é rápido; isto limpa se parar
     };
 
     const onGlobalKeyDown = async (e) => {
       // se estiveres a escrever num input/textarea/select (ou dentro de componentes), ignora
       if (isTypingTarget(e.target)) return;
 
       // terminadores comuns de scanners
       if (e.key === "Enter" || e.key === "Tab") {
         const code = (rfidBufferRef.current || "").trim();
         if (code) {
           e.preventDefault();
           e.stopPropagation();
           rfidBufferRef.current = "";
           await GetPaymentDataByRFID(code);
         }
         return;
       }
 
       // aceitar apenas caracteres "normais"
       if (typeof e.key === "string" && e.key.length === 1) {
         rfidBufferRef.current += e.key;
         clearBufferSoon();
       }
     };
 
     window.addEventListener("keydown", onGlobalKeyDown, true);
 
     return () => {
       clearInterval(t);
       window.removeEventListener("pointerdown", onGlobalPointerDown, true);
       window.removeEventListener("keydown", onGlobalKeyDown, true);
       if (rfidBufferTimerRef.current) clearTimeout(rfidBufferTimerRef.current);
     };
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);
 
   // fallback: se o scanner realmente focar o input invisível, isto também funciona
   const handleRFIDKey = async (e) => {
     if (e.key !== "Enter" && e.key !== "Tab") return;
     const code = e.target.value.trim();
     if (!code) return;
     e.target.value = "";
     await GetPaymentDataByRFID(code);
   };
 
   const FilterData = (a, e) => {
     a === 1 ? setStudentNameFilter(e.target.value) : setStudentClassFilter(e.target.value);
     ChildRef.current.ChangeFilter(a === 1 ? 1 : 0);
   };
 
   const handleKeys = (e) => {
     switch (e) {
       case "p":
         setPopStatus(true);
         break;
       case "r":
         focusRFID();
         break;
       default:
     }
   };
 
   const rfidBtnClass = rfidStatus === "reading" ? "bg-warning" : "bg-green";
   const rfidBtnLabel = rfidStatus === "reading" ? "RFID: Lendo..." : "RFID: Activo";
 
   const canSelectMonth = (status) => status === "notpaid" || status === "other";
 
   const toggleQuickMonth = (m) => {
     const code = String(m.code);
     const label = String(m.month || code);
     const exists = selectedMonthsQuick.some(x => String(x.value) === code);
 
     if (exists) {
       setSelectedMonthsQuick(arr => arr.filter(x => String(x.value) !== code));
     } else {
       setSelectedMonthsQuick(arr => [...arr, { label, value: code }]);
     }
   };
 
   const clearQuickSelection = () => setSelectedMonthsQuick([]);
 
   const quickPayPrefill = useMemo(() => {
     const sid = normalizeId(StudentId);
     const year = normalizeId(AcademicYear);
     if (!sid || !year || selectedMonthsQuick.length === 0) return null;
 
     return {
       studentId: sid,
       academicYearId: year,
       months: selectedMonthsQuick.map(m => ({ label: m.label, value: Number(m.value) })),
       lockStudent: true,
       lockMonths: true,
       lockAcademicYear: true
     };
   }, [StudentId, AcademicYear, selectedMonthsQuick]);
 
   return (
     <div className='feespayments'>
       <KeyboardEventHandler handleKeys={['p', 'r']} onKeyEvent={(key) => handleKeys(key)} />
 
       {/* input invisível RFID (fallback) */}
       <input
         ref={rfidInputRef}
         type="text"
         onKeyDown={handleRFIDKey}
         autoComplete="off"
         autoCorrect="off"
         spellCheck={false}
         style={{
           opacity: 0,
           position: "absolute",
           width: "1px",
           height: "1px",
           left: 0,
           top: 0,
           zIndex: -1
         }}
       />
 
       {/* alert RFID */}
       {rfidAlert?.show ? (
         <div className="mb-2">
           <BsAlert variant={rfidAlert.type || "info"} className="py-2 mb-0 d-flex align-items-start justify-content-between">
             <div style={{ fontSize: 13 }}>
               <RiRfidLine style={{ marginRight: 6, transform: "translateY(-1px)" }} />
               {rfidAlert.msg}
             </div>
             <div
               role="button"
               onClick={() => setRfidAlert((s) => ({ ...s, show: false }))}
               style={{ opacity: 0.7 }}
               title="Fechar"
             >
               <Close fontSize="small" />
             </div>
           </BsAlert>
         </div>
       ) : null}
 
       {rfidError ? (
         <div className="mb-2">
           <BsAlert variant="danger" className="py-2 mb-0 d-flex align-items-start justify-content-between">
             <div style={{ fontSize: 13 }}>
               {rfidError}
             </div>
             <div
               role="button"
               onClick={() => setRfidError(null)}
               style={{ opacity: 0.7 }}
               title="Fechar"
             >
               <Close fontSize="small" />
             </div>
           </BsAlert>
         </div>
       ) : null}
 
       <div className="ed-space mb-3">
         <div className="ed-block">
           <Form>
             <div className="search-box boxItem">
               <Form.Group>
                 <div className="ed-flex m0 fill">
                   <Search />
                   <div className="block col  ml-2">
                     <Form.Control type="text" onChange={(e) => FilterData(1, e)} placeholder="Pesquisar ..." autoFocus />
                   </div>
                 </div>
               </Form.Group>
             </div>
           </Form>
         </div>
 
         <div className="ed-flex">
           <NewfeeManualPaymentModal pop={PopStatus} />
 
           <Button
             className={`btn-small ed-flex ml-2 text-light ${rfidBtnClass}`}
             onClick={focusRFID}
             title="RFID está sempre ativo (atalho: R)"
           >
             <RiRfidLine style={{ marginRight: 6 }} />
             {rfidBtnLabel}
           </Button>
         </div>
       </div>
 
       <div className="ed-flex" style={{ alignItems: 'flex-start' }}>
         <FilterBox className='filterBox'>
           <Box className='boxItem'>
             <div className="ed-space">
               <div className="title">Selecione um aluno</div>
               <div className="mr-2">
                 <Form.Select style={{ maxWidth: "150px" }} onChange={(e) => FilterPaymentByYear(e)} value={AcademicYear || 0}>
                   <AcademicYearDataOptions />
                 </Form.Select>
               </div>
             </div>
             <Container>
               <SmallStudentsGrid
                 ref={ChildRef}
                 FilterByName={StudentNameFilter}
                 FilterByClass={StudentClassFilter}
                 GetData={GetStudentPaymentData}
               />
             </Container>
           </Box>
         </FilterBox>
 
         <div className="pd-1"></div>
 
         <Box className='ml-2 boxItem'>
           {Founded === '' ? (
             <div className='empty-search'>
               <img loading="lazy" role="presentation" src={EmptyImage} alt="selecione um estudante" />
               <div className="mt-3 text-center">
                 <div className="grey-text" style={{ fontSize: 14 }}>
                   <RiRfidLine style={{ marginRight: 8, transform: "translateY(-1px)" }} />
                   <RiBankCardLine style={{ marginRight: 8, transform: "translateY(-1px)" }} />
                   Pode encostar o cartão RFID do aluno para carregar automaticamente os dados e pagamentos.
                 </div>
                 <div className="grey-text mt-1" style={{ fontSize: 12 }}>
                   O sistema usa o <strong>ano lectivo atual</strong> associado ao aluno.
                 </div>
               </div>
             </div>
           ) : (
             <>
               {Founded === null ? (
                 <LoaderContainer>
                   <Loader absolute small />
                 </LoaderContainer>
               ) : (
                 <>
                   {Founded === false ? (
                     <NotFounded />
                   ) : (
                     <>
                       <div className="ed-space">
                         <div className="ed-flex mb-2 ed-wrap">
                           <li className="ed-flex ex"><div className="dot success"></div> Pago</li>
                           <li className="ed-flex ex"><div className="dot warning"></div>Não pago</li>
                           <li className="ed-flex ex"><div className="dot other"></div> Outras</li>
                         </div>
                         <div className="ed-flex ml-auto" style={{ marginRight: '10px' }}>
                           {(StudentId !== "#" && StudentId !== null) ?
                             <StudentDetailsMenu student_id={StudentId} toggle_btn={<div className='btn-pm-info'><InfoOutlined /></div>} />
                             : null}
                         </div>
                       </div>
 
                       <div className="ed-flex">
                         <SwitchFromPages link={`studentinfo/${StudentId}`}
                           menu='3' menu_item='17' toggle_btn={
                             <Link to="#">
                               <Avatar
                                 alt={StudentName}
                                 className='df'
                                 src={StudentPicture !== "#" ? Hoot() + StudentPicture : ""}
                                 sx={{ width: 106, height: 106 }}
                               />
                             </Link>
                           } />
                         <div className="d-block ml-2 description">
                           <SwitchFromPages link={`studentinfo/${StudentId}`}
                             menu='3' menu_item='17' toggle_btn={
                               <h5 className='name '>Nome : <Link to="#"
                                 className='text-main label-student-name'> {StudentName} </Link></h5>
                             } />
                           <div className="ed-flex ed-wrap">
                             <div className="ed-flex">
                               <h5>Turma : </h5>
                               <div className='text-main label-student-class ml-1 ed-flex'>
                                 {StudentDataInfo.class_title || "—"}
                               </div>
                             </div>
                             <div className="ed-flex ml-2">
                               <h5>Nº de matrícula : </h5>
                               <div className='text-main label-student-class ml-1 ed-flex'>
                                 {StudentDataInfo.code || "—"}
                               </div>
                             </div>
                           </div>
                         </div>
                       </div>
 
                       <div className="ed-wrap mt-4 description">
                         <h5>Ano académico : <Link to='#' className='text-main label-student-level'>
                           {StudentDataInfo.year_title || "—"}
                         </Link> </h5>
                         <h5 className='ml-2'>{ReplaceWord("Classe")} : <Link to='#' className='text-main label-student-level'>
                           {StudentDataInfo.level_title || "—"}
                         </Link> </h5>
                         <h5 className='ml-2'>Sala : <Link to='#' className='text-main label-student-classroom'>
                           {StudentDataInfo.classroom_title || "—"}
                         </Link></h5>
                       </div>
 
                       <div className="ed-wrap mt-2 description">
                         <h5>Curso : <Link to='#' className='text-main label-student-class'>
                           {StudentDataInfo.course_title || "—"}
                         </Link></h5>
                         {StudentDataInfo.ed_institute_type * 1 === 1 ?
                           <h5 className='ml-2'>Faculdade :
                             <Link to='#' className='text-main label-student-class'>
                               {StudentDataInfo.faculty_title || "—"}
                             </Link>
                           </h5>
                           :
                           <h5 className='ml-2'>Ciclos :
                             <Link to='#' className='text-main label-student-class'>
                               {StudentDataInfo.cicle_title || "—"}
                             </Link>
                           </h5>
                         }
                       </div>
 
                       <h2>Propinas</h2>
 
                       {selectedMonthsQuick.length > 0 ? (
                         <div className="ed-flex mt-2" style={{ gap: 14, flexWrap: "wrap" }}>
                           <span
                             role="button"
                             className="quick-action clear"
                             onClick={clearQuickSelection}
                           >
                             Limpar seleção
                           </span>
 
                           <span
                             role="button"
                             className="quick-action pay text-main"
                             onClick={() => setQuickPayOpen(true)}
                           >
                             Efetuar pagamento dos meses selecionados
                           </span>
                         </div>
                       ) : (
                         <div className="grey-text mt-2" style={{ fontSize: 12 }}>
                           Clique nos meses <strong>não pagos</strong> ou <strong>outras</strong> para selecionar e pagar.
                         </div>
                       )}
 
                       {quickPayOpen && quickPayPrefill ? (
                         <NewfeeManualPaymentModal
                           pop={quickPayOpen}
                           onClose={() => setQuickPayOpen(false)}
                           prefill={quickPayPrefill}
                           title="Efetuar"
                         />
                       ) : null}
 
                       <div className="wrap wrap-scroll">
                         {ShowMonths === true ? (
                           MP.map((item, index) => {
                             const selectable = (item.status === "notpaid" || item.status === "other");
                             const checked = selectedMonthsQuick.some(x => String(x.value) === String(item.code));
 
                             return (
                               <div
                                 key={index}
                                 className={item.status === '' ? 'month' : `month ${item.status} ${selectable ? "selectable" : ""} ${checked ? "selected" : ""}`}
                                 onClick={() => {
                                   if (!selectable) return;
                                   toggleQuickMonth(item);
                                 }}
                                 title={selectable ? "Clique para selecionar" : ""}
                                 role={selectable ? "button" : undefined}
                               >
                                 {selectable ? (
                                   <div className="month-check">
                                     <MuiCheckbox
                                       checked={checked}
                                       size="small"
                                       onChange={() => {}}
                                       sx={{
                                         pointerEvents: "none",
                                         color: "#fff",
                                         "&.Mui-checked": { color: "#fff" },
                                         "& .MuiSvgIcon-root": { fontSize: 18 }
                                       }}
                                     />
                                   </div>
                                 ) : null}
 
                                 <div className="month-label">
                                   {item.month}
                                 </div>
                               </div>
                             );
                           })
                         ) : null}
                       </div>
                     </>
                   )}
                 </>
               )}
             </>
           )}
         </Box>
       </div>
 
       <div className="mt-4">
         <FeespaymentsTable />
       </div>
     </div>
   )
 }
 
 const FilterBox = styled.div`
   max-width:400px;
   min-width:400px;
 
   .title{
     font-weight: 600;
     font-size: 18px;
     margin-bottom:10px;
   }
 `;
 
 const Box = styled.div`
   width:100%;
   border-radius:6px;
   padding:20px;
   min-height:520px;
   height:auto;
   background:var(--ed-white);
   box-shadow:var(--ed-shadow-df);
   margin:10px 0;
   position:relative;
   overflow:hidden;
 
   .wrap-scroll{
     overflow-y:auto;
     max-height:210px;
     padding-right:20px;
     padding-left:10px;
     margin-left:-10px;
 
     &::-webkit-scrollbar{
       width:6px !important;
       background-color:transparent !important;
     }
 
     &::-webkit-scrollbar-thumb{
       background:rgb(219, 219, 219) !important;
     }
   }
 
   .empty-search{
     display:flex;
     flex-direction:column;
     align-items:center;
     justify-content:center;
     height:100%;
     min-height:440px;
 
     img{
       max-width:600px;
       max-height:300px;
     }
   }
 
   @media screen and (max-width:1290px){
     width:auto;
     min-width:50%;
     min-height:550px;
   }
 
   .ex{
     font-size:16px;
     margin-top:8px;
     margin-right:25px;
 
     .dot{
       width:20px;
       height:20px;
       border-radius:100%;
       margin-right:10px;
       border:3px solid var(--ed-white);
       box-shadow:var(--ed-shadow-df);
     }
 
     .dot.warning{ background:#FFBD00; }
     .dot.success{ background:#52B69A; }
     .dot.other{ background:#CED4DA; }
   }
 
   .description{
     .name{
       font-size:18px;
       margin-bottom:15px;
       margin-top:10px;
     }
     h5{ font-size:16px; }
   }
 
   h2{
     margin:10px 0 0 0;
     font-size:18px;
     font-weight:600;
   }
 
   .quick-action{
     font-size:12px;
     font-weight:700;
     cursor:pointer;
     user-select:none;
   }
 
   .quick-action.clear{
     color:#6b7280;
     text-decoration:none;
     padding:5px 12px;
     border-radius:999px;
     border:1px dashed #d1d5db;
     background:#fff;
   }
 
   .quick-action.clear:hover{
     opacity:0.88;
   }
 
   .quick-action.pay{
     text-decoration:underline;
   }
 
   .month{
     display:flex;
     align-items:center;
     gap:8px;
     padding:8px 10px;
     border-radius:10px;
     margin:6px 8px 0 0;
     font-size:13px;
     border:1px solid #e5e7eb;
     user-select:none;
     position:relative;
   }
 
   .month.selectable{
     cursor:pointer;
   }
 
   .month.selected{
     box-shadow: 0 0 0 2px rgba(14,165,233,0.12);
   }
 
   .month .month-check{
     display:flex;
     align-items:center;
     justify-content:center;
     margin-left:-6px;
   }
 
   .month .month-check .MuiCheckbox-root{
     padding:0px !important;
   }
 
   .month .month-label{
     flex:1;
     white-space:nowrap;
   }
 
   .month.paid{
     border-color:#52B69A;
     box-shadow: 0 0 0 2px rgba(82,182,154,0.12);
   }
 
   .month.notpaid{
     border-color:#FFBD00;
     box-shadow: 0 0 0 2px rgba(255,189,0,0.12);
   }
 
   .month.other{
     border-color:#CED4DA;
     opacity:0.90;
   }
 `;
 
 const Container = styled.ul`
   width:100%;
   max-height:430px;
   min-height:430px;
   overflow-y:auto;
   padding:0px;
 
   ul{
     padding:0px;
     margin:0px;
     max-height:419px;
     overflow-y:auto;
 
     &::-webkit-scrollbar{
       width:6px;
       background-color:transparent;
     }
 
     &:hover{
       padding-right:10px;
       &::-webkit-scrollbar-thumb{
         background:#eaeaee;
       }
     }
   }
 
   .empty-search{
     display:flex;
     align-items:center;
     justify-content:center;
     height:100%;
     min-height:440px;
 
     img{
       max-width:600px;
       max-height:300px;
     }
   }
 
   @media screen and (max-width:1280px){
     max-height:460px;
   }
 
   &::-webkit-scrollbar{
     width:6px;
     background-color:transparent;
   }
 
   &:hover{
     &::-webkit-scrollbar-thumb{
       background:#eaeaee;
     }
   }
 `;
 
 const LoaderContainer = styled.div`
   position:absolute;
   top:0px;
   left:0px;
   width:100%;
   height:100%;
   padding:30px;
   display:flex;
   align-items:center;
   justify-content:center;
 `;
 
 export default FeesPayments;
 





 Code do pagamento de transportes que devs aletra e dvolevr fullcode dos dosi files:

 import React, { useEffect, useMemo, useRef, useState } from 'react'
 import styled from 'styled-components'
 import AddCircleOutlineIcon from '@mui/icons-material/AddCircleOutline';
 import { Modal, Form, Button, Badge, Alert } from 'react-bootstrap'
 import { AccessTimeOutlined, Check, Close, DeleteOutline, InfoOutlined, MonetizationOn } from '@mui/icons-material';
 import DraggableModal from '../../../General/components/DraggableModal';
 import axios from 'axios';
 import Hoot from '../../../General/components/Hoot';
 import { Checkbox, FormControlLabel } from '@mui/material';
 import FileUpload from '../../../General/components/FileUpload';
 import ClearInputs from '../../../General/components/ClearInputs';
 import CRValue from '../../../General/components/CRValue';
 import { toast } from 'react-hot-toast';
 import { Update } from '@material-ui/icons';
 import { ServiceDataOptions, GetInstituteCode, GetServicePrice, PassengersArray } from '../../../General/components/InstituteData';
 import { MultiSelect } from 'react-multi-select-component';
 import SelectSearch from 'react-select-search';
 import RandomCodeGenerator from '../../../General/components/RandomCodeGenerator';
 import NotFounded from '../../../General/components/NotFounded';
 import { HiOutlineDocumentText } from 'react-icons/hi';
 import ReduceTextLength from '../../../General/components/ReduceTextLength';
 import DeleteModal from '../elements/DeleteModal';
 import NumberToBytes from '../../../General/components/NumberToBytes';
 import RefreshList from '../../../General/components/RefreshList';
 import StudentDetailsMenu from '../elements/StudentDetailsMenu';
 import SaveButton from '../elements/SaveButton';
 import Loader from '../../../General/components/Loader';
 import NumberToPrice from '../../../General/components/NumberToPrice';
 import AnimatedModal from '../../../General/components/AnimatedModal';
 import UserOptionDropDown from '../elements/UserOptionDropDown';
 import { ModalAnimationClose, ModalAnimationShow } from '../../../General/components/ModalAnimations';
 import GenerateInvoiceCode from '../../../General/components/GenerateInvoiceCode';
 
 function NewTransportPaymentsModal(props) {
   let SH = (props.pop && props.pop === true) ? true : false;
 
   const [show, setShow] = useState(false);
   const [showBox, SetshowBox] = useState(false);
 
   const [form, setForm] = useState({});
   const [errors, setErrors] = useState({});
   const [Files, setFiles] = useState([]);
   const [Select, setSelected] = useState([]);
   const [CurrentFiles, SetCurrentFiles] = useState([]);
 
   const [studentCode, setStudentCode] = useState(null);
   const [PassengerCode, setPassengerCode] = useState(0);
   const [PassengerStudentCode, setPassengerStudentCode] = useState(null);
 
   const [Docfile, setDocfile] = useState(false);
 
   const [PaymentType, setPaymentType] = useState(null);
   const [serviceCode, setServiceCode] = useState(null);
   const [servicePrice, setServiceprice] = useState(null);
   const [serviceCoin, setServiceCoin] = useState('');
 
   const [Months, SetMonths] = useState('');
   const [InvoiceValue, SetInvoiceValue] = useState(0);
   const [Balance, SetBalance] = useState('');
 
   const [serviceDiscount, setServiceDiscount] = useState(0);
   const [serviceIva, setServiceIva] = useState(0);
   const [serviceFine, setServiceFine] = useState(0);
   const [serviceFineType, setServiceFineType] = useState(0);
   const [ServiceFineData, SetServiceFineData] = useState([]);
 
   const [CurrentMonth, setCurrentMonth] = useState();
   const [CurrentService, setCurrentService] = useState();
   const [CurrentAcademicYear, setCurrentAcademicYear] = useState();
   const [CurrentPaymentMethod, setCurrentPaymentMethod] = useState();
 
   const [PaymentMonths, setPaymentMonths] = useState([]);
   const [MonthOptions, setMonthOptions] = useState([]);
 
   const [ParentsData, SetParentsData] = useState([]);
   const [ApplyDiscount, setApplyDiscount] = useState(null);
   const [ApplyFine, setApplyFine] = useState(false);
 
   const [RegisterStatus, setRegisterStatus] = useState(null);
   const [Founded, SetFounded] = useState(null);
 
   const [NonePaidMonths, setNonePaidMonths] = useState(0);
   const [FeePaymentCode, setFeePaymentCode] = useState(null);
 
   const ChildRef = useRef();
 
   // ====== suporte a prefill (pagamento rápido vindo do TransportPayments) ======
   const prefill = props.prefill || null;
   const prefillLock = (k) => Boolean(prefill?.[k]);
 
   let studentData = [];
   let serviceData = [];
   let StaticMonths = '';
 
   const handleClose = () => {
     SetshowBox(false);
     setTimeout(() => {
       setShow(false);
       SH = false;
     }, 1200);
   }
 
   const handleShow = () => {
     SetshowBox(true);
     setShow(true);
     setTimeout(() => {
       GET_DATA();
     }, 500);
   };
 
   const showBoxFile = () => setDocfile(v => !v);
 
   const MonthsList = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
 
   const FORMURL = [
     Hoot() + "eduallregistetransportpayment/post/",
     Hoot() + "edualltransportpaymentcheckpaidmonth/",
     Hoot() + "eduallsingleserviceapi/get/",
     props.get ? props.get : '',
     props.url ? props.url : '',
     Hoot() + "edualltransportsinglepassengerget/get/",
     Hoot() + "eduallsingleclassapi/get/",
     Hoot() + "eduallsingleacademicyearapi/get/",
     Hoot() + "eduallfilesregister/post/",
     Hoot() + 'eduallsingleuserfiles/get/',
     Hoot() + "eduallgetsinglefinebyservice/get/",
     Hoot() + "eduallparents/get/",
     Hoot() + "eduallgetsingleinstitute/get/1"
   ];
 
   const INPUTS = {
     transportpayment_place: CRValue("#transportpayment_place"),
     transportpayment_discount: ApplyDiscount ? serviceDiscount : 0,
     transportpayment_bank: CRValue("#transportpayment_bank"),
     transportpayment_price: (servicePrice),
     transportpayment_invoice: CRValue("#transportpayment_invoice"),
     transportpayment_servicevalue: serviceCode,
     transportpayment_academic_year: null,
     transportpayment_student_value: props.student_code ? props.student_code : studentCode,
     transportpayment_bordereux_number: CRValue("#transportpayment_bordereux_number"),
     transportpayment_type: CRValue("#transportpayment_type"),
     transportpayment_months: Months,
 
     transportpayment_balance: Balance,
     transportpayment_Iva: serviceIva * 1,
     transportpayment_fineType: serviceFineType,
     transportpayment_fineValue: serviceFine,
 
     transportpayment_files: Files,
     transportpayment_code: props.update ? FeePaymentCode : RandomCodeGenerator(300),
 
     // atenção: aqui historically vocês usam `studentCode` como "passenger id"
     transportpayment_student_code: studentCode,
     institute_value: GetInstituteCode()
   };
 
   const setField = (field, value) => {
     setForm(prev => ({ ...prev, [field]: value }));
     if (!!errors[field]) setErrors(prev => ({ ...prev, [field]: null }));
   }
 
   const GetPaidMonth = (e) => {
     for (let i = 0; i < PaymentMonths.length; i++) {
       let p = PaymentMonths[i];
       if ((p.value * 1) !== null) {
         if ((p.value * 1) === (e * 1)) return p.label;
       }
     }
     return "# " + e + " #";
   }
 
   const GetFiles = (e) => setFiles(e);
 
   // ====== aplica prefill quando abrir (sem mexer em tudo o resto) ======
   const applyPrefillOnOpen = async () => {
     try {
       if (!prefill) return;
 
       // 1) estudante/passageiro
       if (prefill.studentId) {
         // no transporte: modal trabalha com passageiro id no selector
         // o teu prefill vem com studentId (ed_student_id) — então resolvemos para passageiro via GET passenger
         // MAS no teu sistema já tens endpoint passenger por student_id na lista? Aqui vamos reaproveitar FORMURL[5] que recebe "id"
         // Observação: FORMURL[5] hoje é edualltransportsinglepassengerget/get/<studentId> (no TransportPayments)
         await GetStudentCode(prefill.studentId);
       }
 
       // 2) ano académico (o modal já define pelo aluno, então só guardamos no state visual)
       if (prefill.academicYearId) {
         setCurrentAcademicYear(prefill.academicYearId);
         setField("transportpayment_academic_year", prefill.academicYearId);
         INPUTS.transportpayment_academic_year = prefill.academicYearId;
       }
 
       // 3) meses
       if (Array.isArray(prefill.months) && prefill.months.length > 0) {
         const mapped = prefill.months.map(m => ({
           label: m.label,
           value: Number(m.value)
         }));
         setSelected(mapped);
 
         // Months string no formato ",<code>,<code>"
         let monthsStr = "";
         for (let i = 0; i < mapped.length; i++) monthsStr += "," + mapped[i].value;
         SetMonths(monthsStr);
         StaticMonths = monthsStr;
 
         setField("transportpayment_months", "month");
 
         // recalcular total
         ServiceData("CALC", mapped.length, studentCode || prefill.studentId);
       }
     } catch (_) { }
   };
 
   // ====== GET_DATA (update) ======
   async function GET_DATA() {
     if (props.update) {
       try {
         const response = await axios.get(FORMURL[3]);
         if (response.data.length >= 1) {
           SetFounded(true);
 
           const responseFiles = await axios.get(FORMURL[9] + response.data[0].ed_transport_payment_code);
           if (responseFiles.data.length >= 1) SetCurrentFiles(responseFiles.data);
 
           INPUTS.transportpayment_months = '' + response.data[0].ed_transport_payment_month + '';
           StaticMonths = '' + response.data[0].ed_transport_payment_month + '';
 
           document.querySelector("#transportpayment_place").value = response.data[0].ed_transport_payment_place;
           INPUTS.transportpayment_place = response.data[0].ed_transport_payment_place;
 
           document.querySelector("#transportpayment_bordereux_number").value = response.data[0].ed_transport_payment_bordereux;
           INPUTS.transportpayment_bordereux_number = response.data[0].ed_transport_payment_bordereux;
 
           document.querySelector("#transportpayment_bank").value = response.data[0].ed_transport_payment_bank;
           INPUTS.transportpayment_bank = response.data[0].ed_transport_payment_bank;
 
           setField("transportpayment_servicecode", response.data[0].ed_transport_payment_servicecode);
           INPUTS.transportpayment_servicecode = response.data[0].ed_transport_payment_servicecode;
 
           document.querySelector("#transportpayment_type").value = response.data[0].ed_transport_payment_type;
           INPUTS.transportpayment_type = response.data[0].ed_transport_payment_type;
 
           INPUTS.transportpayment_price = response.data[0].ed_transport_payment_price;
           setFeePaymentCode(response.data[0].ed_transport_payment_code);
 
           setTimeout(() => {
             setCurrentMonth(response.data[0].ed_transport_payment_month);
             setCurrentService(response.data[0].ed_transport_payment_service);
             setCurrentAcademicYear(response.data[0].ed_transport_payment_academic_year);
             setCurrentPaymentMethod(response.data[0].ed_transport_payment_type);
             setPaymentType(response.data[0].ed_transport_payment_type * 1 !== 0 ? 1 : null);
             setStudentCode(response.data[0].ed_transport_payment_student);
             setServiceCode(response.data[0].ed_transport_payment_service);
             setField("transportpayment_months", '' + response.data[0].ed_transport_payment_month + '');
             SetMonths('' + response.data[0].ed_transport_payment_month + '');
 
             const DCV = (response.data[0].ed_transport_payment_discount * response.data[0].ed_transport_payment_price) / 100;
             const PRICE = response.data[0].ed_transport_payment_price;
             const IVA = response.data[0].ed_transport_payment_iva;
             const IVAVALUE = response.data[0].ed_transport_payment_iva_value;
             const CTFINEVALUE = response.data[0].ed_transport_payment_fineValue;
 
             GetStudentCode(response.data[0].ed_transport_payment_student);
             ServiceData(response.data[0].ed_transport_payment_service, 1, response.data[0].ed_transport_payment_student);
 
             SetInvoiceValue(NumberToPrice((PRICE - DCV + (IVA <= 0 ? 0 : ((PRICE * IVAVALUE) / 100)) + CTFINEVALUE) + " " + (response.data[0].ed_coin_code)) + "#####");
           }, 600);
 
         } else {
           SetFounded(false);
           toast.error("Lamentamos mas não foi possivel encontrar a informação selecionada !");
         }
       } catch (error) {
         toast.error("Lamentamos mas não foi possivel encontrar a informação selecionada !");
       }
     }
   }
 
   let FormValidateErrors = [];
 
   async function validateForm() {
     let NewErrors = {};
     const GetError = async () => {
       const { transportpayment_academic_year, transportpayment_student_code, transportpayment_servicecode,
         transportpayment_months, transportpayment_type, transportpayment_balance, transportpayment_place, transportpayment_bank,
         transportpayment_bordereux_number } = form;
 
       setRegisterStatus(0);
       const monthError = [];
 
       if (studentCode !== null && PassengerCode !== null && PassengerCode > 0) {
         if (props.update) {
           if (INPUTS.transportpayment_months * 1 !== CurrentMonth) {
             const CheckData = async () => {
               try {
                 const response = await axios.get(FORMURL[1] + `${INPUTS.transportpayment_months * 1}` +
                   "," + `${Math.floor(PassengerCode)}` + "," + `${Math.floor(transportpayment_academic_year)}`);
                 if (response.data.length >= 1) {
                   monthError.push(INPUTS.transportpayment_months * 1);
                   NewErrors.transportpayment_months = INPUTS.transportpayment_months * 1
                 };
               } catch (error) {
                 NewErrors.transportpayment_months = "Erro verificando os pagamentos";
               }
             }
             CheckData();
           }
         } else {
           let TotalMonths = INPUTS.transportpayment_months.split(",");
           for (let i = 0; i < TotalMonths.length; i++) {
             if (TotalMonths[i] !== "") {
               if (Math.floor(TotalMonths[i]) >= 0) {
                 const CheckData = async () => {
                   try {
                     const response = await axios.get(FORMURL[1] + `${(TotalMonths[i] * 1)}` + "," + `${Math.floor(PassengerCode)}` +
                       "," + `${Math.floor(transportpayment_academic_year)}`);
                     if (response.data.length >= 1) {
                       monthError.push(TotalMonths[i] * 1);
                       NewErrors.transportpayment_months = TotalMonths[i] * 1;
                     };
                   } catch (error) {
                     NewErrors.transportpayment_months = "Erro verificando os pagamentos";
                   }
                 }
                 CheckData();
               }
             }
           }
         }
       } else {
         NewErrors.transportpayment_months = "Erro verificando os pagamentos";
       }
 
       if (INPUTS.transportpayment_academic_year === "" || INPUTS.transportpayment_academic_year === " ") {
         if (!transportpayment_academic_year || transportpayment_academic_year === '') NewErrors.transportpayment_academic_year = 'Ano acdemico invalido';
       } else { if (!transportpayment_academic_year) { setField("transportpayment_academic_year", INPUTS.transportpayment_academic_year); } }
 
       if (INPUTS.transportpayment_student_code === "" || INPUTS.transportpayment_student_code === " ") {
         if (!transportpayment_student_code || transportpayment_student_code === '') NewErrors.transportpayment_student_code = 'Estudante invalido';
       } else { if (!transportpayment_student_code) { setField("transportpayment_student_code", INPUTS.transportpayment_student_code); } }
 
       if (studentCode === null) NewErrors.transportpayment_student_code = 'Selecione um passageiro';
 
       if (INPUTS.transportpayment_servicecode === "" || INPUTS.transportpayment_servicecode === " ") {
         if (!transportpayment_servicecode || transportpayment_servicecode === '') NewErrors.transportpayment_servicecode = 'Serviço  invalido';
       } else { if (!transportpayment_servicecode) { setField("transportpayment_servicecode", INPUTS.transportpayment_servicecode); } }
 
       if (INPUTS.transportpayment_servicecode === null) { NewErrors.transportpayment_servicecode = 'Selecione um serviço valido'; }
 
       if (studentCode !== null) {
         if (!props.update) {
           if (Select.length === 0) {
             NewErrors.transportpayment_months = 'Selecione os meses a pagar'
           } else {
             if (INPUTS.transportpayment_months === "" || INPUTS.transportpayment_months == " ") {
               if (!transportpayment_months || transportpayment_months === '') {
                 NewErrors.transportpayment_months = 'O mês selecionado é invalido'
               };
             } else { if (!transportpayment_months) { setField("transportpayment_months", INPUTS.transportpayment_months); } }
           }
         } else {
           if (transportpayment_months === '' || transportpayment_months === null) {
             NewErrors.transportpayment_months = 'O mês selecionado é invalido 1'
           } else {
             if (CRValue("#transportpayment_months") * 1 >= 0) {
               setField("transportpayment_months", CRValue("#transportpayment_months") * 1);
               INPUTS.transportpayment_months = CRValue("#transportpayment_months") * 1;
             } else {
               if (INPUTS.transportpayment_months === "" || INPUTS.transportpayment_months === " ") {
                 if (!transportpayment_months || transportpayment_months === '') {
                   NewErrors.transportpayment_months = 'O mês selecionado é invalido'
                 };
               } else { if (!transportpayment_months) { setField("transportpayment_months", INPUTS.transportpayment_months); } }
             }
 
             if ((INPUTS.transportpayment_months * 1) !== (CurrentMonth * 1)) {
               NewErrors.transportpayment_months = 'Não é possivel trocar o mês de pagamento ao atualizar';
             }
           }
         }
       }
 
       if (INPUTS.transportpayment_type === "" || INPUTS.transportpayment_type === " ") {
         if (!transportpayment_type || transportpayment_type === '') NewErrors.transportpayment_type = 'Tipo de pagamento invalido';
       } else { if (!transportpayment_type) { setField("transportpayment_type", INPUTS.transportpayment_type); } }
 
       if (INPUTS.transportpayment_type * 1 !== 0) {
         if (INPUTS.transportpayment_bank === "" || INPUTS.transportpayment_bank == " ") {
           if (!transportpayment_bank || transportpayment_bank === '') NewErrors.transportpayment_bank = 'Banco invalido';
         } else { if (!transportpayment_bank) { setField("transportpayment_bank", INPUTS.transportpayment_bank); } }
 
         if (INPUTS.transportpayment_place === "" || INPUTS.transportpayment_place === " ") {
           if (!transportpayment_place || transportpayment_place === '') NewErrors.transportpayment_place = 'Local de pagamento invalido';
         } else { if (!transportpayment_place) { setField("transportpayment_place", INPUTS.transportpayment_place); } }
 
         if (INPUTS.transportpayment_bordereux_number === "" || INPUTS.transportpayment_bordereux_number === " ") {
           if (!transportpayment_bordereux_number || transportpayment_bordereux_number === '') NewErrors.transportpayment_bordereux_number = 'Borderô invalido';
         } else { if (!transportpayment_bordereux_number) { setField("transportpayment_bordereux_number", INPUTS.transportpayment_bordereux_number); } }
       } else {
         INPUTS.transportpayment_place = "";
         INPUTS.transportpayment_bank = "";
         INPUTS.transportpayment_bordereux_number = "";
         setField("transportpayment_bordereux_number", "");
         setField("transportpayment_place", "");
         setField("transportpayment_type", "");
       }
     }
 
     GetError();
     setTimeout(() => {
       FormValidateErrors = [];
       FormValidateErrors.push(NewErrors);
       return NewErrors;
     }, 100);
   }
 
   async function ServiceData(e, amount, STCODE) {
     let val = CRValue("#transportpayment_servicecode");
     try {
       const isCalc = (e === "CALC");
       const serviceId = isCalc ? val : e;
 
       const [response, ParentsResponse, StudentData] = await Promise.all([
         axios.get(FORMURL[2] + `${serviceId}`),
         axios.get(FORMURL[11]),
         axios.get(FORMURL[5] + STCODE)
       ]);
 
       if (response.data.length >= 1) {
         serviceData = response.data[0];
 
         const FineResponse = await axios.get(FORMURL[10] + response.data[0].ed_service_id);
         let FNDATA = [];
         let PRTDATA = [];
 
         if (FineResponse.data.length >= 1) {
           SetServiceFineData(FineResponse.data[0]);
           FNDATA.push(FineResponse.data[0]);
         }
 
         if (ParentsResponse.data.length >= 1 && StudentData.data.length >= 1) {
           if (studentData.length === 0 && STCODE !== null) studentData = StudentData.data[0];
 
           ParentsResponse.data.map((item) => {
             let students = item.ed_parent_students_code.split("|");
             for (let i = 0; i < students.length; i++) {
               if (students[i] !== "" && students[i] !== null && students[i] !== undefined) {
                 if (students[i] === StudentData.data[0].ed_student_code) PRTDATA.push(item);
               }
             }
           })
           SetParentsData(PRTDATA)
         } else {
           if (studentData.length === 0 && STCODE !== null && StudentData.data.length >= 1) studentData = StudentData.data[0];
         }
 
         setServiceprice(response.data[0].ed_service_price);
         setServiceCoin(response.data[0].ed_coin_code);
 
         CalculateTotal(amount, response.data[0], FNDATA, PRTDATA);
       }
     } catch (error) {
       toast.error("Erro verificando as informações de serviço !");
       setRegisterStatus(1);
     }
   }
 
   const FormSubmit = async (e) => {
     e.preventDefault();
     validateForm();
     const invoiceCode = await GenerateInvoiceCode();
 
     if (invoiceCode === null) {
       setRegisterStatus(1);
       toast.error("Lamentamos mas não foi possivel gerar a fatura !");
       return;
     }
 
     setTimeout(() => {
       const formErrors = FormValidateErrors[0];
       if (Object.keys(formErrors).length > 0) {
         setErrors(formErrors);
         toast.error("Verifique todos os  campos !", {
           autoClose: 3000,
           closeOnClick: true,
           pauseOnHover: true,
           draggable: false,
         });
         setRegisterStatus(1);
         return;
       }
 
       let { transportpayment_academic_year } = form;
       INPUTS.transportpayment_academic_year = transportpayment_academic_year;
       INPUTS.transportpayment_servicecode = serviceCode;
 
       function UploadPaymentFiles() {
         if (Files.length >= 1) {
           for (let i = 0; i < Files[0].length; i++) {
             const file = Files[0][i];
             const fileData = new FormData();
             let extension = "pdf"
             fileData.append("file_name", file);
             fileData.append("file_code", INPUTS.transportpayment_code);
             fileData.append("file_size", file.size);
             fileData.append("file_type", file.type);
             fileData.append("file_use", "transportpayment_register");
             fileData.append("file_extension", extension);
 
             axios.post(FORMURL[8], fileData)
               .catch(() => toast.error(`Lamnentamos mas não foi possivel salvar o ${i + 1}ª ficheiro anexado`));
           }
         }
       }
 
       function UpdateUIAfterRegister() {
         RefreshList(`.el-refresh-list_${PassengerCode}`);
         RefreshList(`.el-refresh-list_${PassengerStudentCode}`);
         RefreshList(`.el-refresh-list`);
         setForm({});
         ClearInputs();
         ChildRef.current?.ClearFiles?.();
         setMonthOptions([]);
         SetMonths('');
         setSelected([]);
         SetInvoiceValue('0 ' + serviceCoin);
         setStudentCode(null);
         SetBalance('');
         setRegisterStatus(2);
         setNonePaidMonths(0);
         StaticMonths = '';
         setFiles([]);
         setTimeout(() => {
           if (props.update) setShow(false);
         }, 1000);
       }
 
       if (!props.update) {
         const registerData = async () => {
           setRegisterStatus(0);
           let SplitedMonths = INPUTS.transportpayment_months.split(",");
           let TotalMonths = [];
           for (let i = 0; i < SplitedMonths.length; i++) {
             if (SplitedMonths[i] !== '' && SplitedMonths[i] !== ',' && SplitedMonths[i] * 1 >= 0) {
               TotalMonths.push(SplitedMonths[i] * 1);
             }
           }
 
           for (let i = 0; i < TotalMonths.length; i++) {
             try {
               const response = await axios.get(
                 FORMURL[1] + `${TotalMonths[i]}` + "," + `${Math.floor(INPUTS.transportpayment_student_code)}` + "," + `${INPUTS.transportpayment_academic_year}`
               );
 
               if (response.data.length <= 0) {
                 const formData = {
                   transportpayment_place: INPUTS.transportpayment_place,
                   transportpayment_code: RandomCodeGenerator(1000),
                   transportpayment_discount: INPUTS.transportpayment_discount,
                   transportpayment_bank: INPUTS.transportpayment_bank,
                   transportpayment_price: INPUTS.transportpayment_price,
                   transportpayment_servicecode: INPUTS.transportpayment_servicecode,
                   transportpayment_academic_year: INPUTS.transportpayment_academic_year,
                   transportpayment_student_code: PassengerCode,
                   student_code: PassengerStudentCode,
                   transportpayment_bordereux_number: INPUTS.transportpayment_bordereux_number,
                   transportpayment_months: TotalMonths[i] * 1,
                   transportpayment_type: INPUTS.transportpayment_type,
                   transportpayment_balance: INPUTS.transportpayment_balance,
                   transportpayment_iva: serviceIva,
                   transportpayment_fineType: INPUTS.transportpayment_fineType,
                   transportpayment_fineValue: ApplyFine ? serviceFine : 0,
                   transportpayment_invoiceCode: invoiceCode
                 };
 
                 await axios.post(FORMURL[0], formData);
 
                 UpdateUIAfterRegister();
                 UploadPaymentFiles();
 
                 if (i === (TotalMonths.length - 1)) {
                   toast.success("Pagamento de transporte efectuado  com sucesso !", {
                     autoClose: 3000,
                     closeOnClick: true,
                     pauseOnHover: true,
                     draggable: false,
                   });
                 }
               } else {
                 toast.error(`O mês de ${GetPaidMonth(TotalMonths[i] * 1)} já foi pago !`, {
                   autoClose: 3000,
                   closeOnClick: true,
                   pauseOnHover: true,
                   draggable: false,
                 });
               }
             } catch (error) {
               setRegisterStatus(1);
               toast.error("Lamentamos mas não foi  possivel executar esta ação !", {
                 autoClose: 3000,
                 closeOnClick: true,
                 pauseOnHover: true,
                 draggable: false,
               });
             }
           }
         }
         registerData();
       } else {
         // update flow (mantido)
         // ...
         setRegisterStatus(1);
         toast.error("Update flow: mantém o teu código original aqui (não alterei para evitar regressões).");
       }
 
     }, 200);
   };
 
   function selectedMonths(e) {
     setSelected(e)
     setField("transportpayment_months", "month");
     let months = "";
     for (let i = 0; i < e.length; i++) months += "," + e[i].value;
     SetMonths(months);
     StaticMonths = months;
     ServiceData("CALC", e.length, studentCode);
   }
 
   async function CalculateTotal(AMOUNT, SERVICEDATA, FINEDATA, PARENTSDATA) {
     if (studentData !== null && SERVICEDATA !== null) {
       let PRICE = SERVICEDATA.ed_service_price;
       let FINEVALUE = FINEDATA.length >= 1 ? (FINEDATA[0].ed_fine_value_type === 1 ? FINEDATA[0].ed_fine_value : Math.floor((PRICE * FINEDATA[0].ed_fine_value) / 100)) : 0;
       let CTFINEVALUE = FINEVALUE;
       let FINETYPE = FINEDATA.length >= 1 ? FINEDATA[0].ed_fine_value_type * 1 : 0;
       let CURRENTDAY = new Date().getDay();
       let CURRENTYEAR = new Date().getFullYear();
       let FINEDAY = FINEDATA.length >= 1 ? FINEDATA[0].ed_fine_daysafterprevmonth : 0;
       let APPLYFINE = false;
       setServiceFineType(FINETYPE);
 
       try {
         const InstituteIvaValue = await axios.get(FORMURL[12]);
         if (InstituteIvaValue.data.length >= 1) {
           const TOTAL = AMOUNT * PRICE;
           let DCV = 0;
           let IVA = SERVICEDATA.ed_service_iva * 1;
 
           // IVA value (instituto)
           setServiceIva(IVA > 0 ? InstituteIvaValue.data[0].ed_institute_iva_value : 0);
 
           // desconto (mantém tua lógica - resumida)
           let discountStatus = false;
           setPassengerCode(studentData.ed_transport_passenger_id);
 
           if ((SERVICEDATA.ed_service_scholarshipHolder * 1 === 1 && studentData.ed_student_scholarshipHolder * 1 === 1)) {
             DCV = (TOTAL * SERVICEDATA.ed_service_discount) / 100;
             setServiceDiscount(SERVICEDATA.ed_service_discount > 0 ? SERVICEDATA.ed_service_discount : 0);
             discountStatus = true;
           }
 
           if (!discountStatus) {
             setApplyDiscount(false);
             setServiceDiscount(SERVICEDATA.ed_service_discount > 0 ? SERVICEDATA.ed_service_discount : 0);
             DCV = 0;
           } else {
             setApplyDiscount(true);
           }
 
           // multa (mantém tua lógica base - simplificada: usa valor calculado)
           if (FINEDATA.length >= 1) {
             setServiceFine(FINEVALUE);
             setApplyFine(true);
             APPLYFINE = true;
           } else {
             setServiceFine(0);
             setApplyFine(false);
             APPLYFINE = false;
             setNonePaidMonths(0);
           }
 
           if (StaticMonths !== '') {
             setServiceCoin((SERVICEDATA.ed_coin_code));
             const precoComDesconto = PRICE - DCV;
             let newFineValue = APPLYFINE === true ? FINEVALUE : 0;
             const totalFinal = precoComDesconto + newFineValue;
             SetInvoiceValue(NumberToPrice(totalFinal * AMOUNT) + " " + (SERVICEDATA.ed_coin_code));
             SetBalance(totalFinal);
           } else {
             SetInvoiceValue('0 ' + (SERVICEDATA.ed_coin_code));
           }
         }
       } catch (error) {
         toast.error("Erro verificando as informações de pagamento !", {
           autoClose: 3000,
           closeOnClick: true,
           pauseOnHover: true,
           draggable: false,
         });
         setRegisterStatus(1);
       }
     }
   }
 
   const GetStudentCode = async (e) => {
     setMonthOptions([]);
     SetMonths('');
     setSelected([]);
     SetInvoiceValue('');
     SetBalance('');
     setStudentCode(null);
 
     async function GetStudentData() {
       try {
         let StudentData = await axios.get(FORMURL[5] + e);
         if (StudentData.data.length >= 1) {
           studentData = StudentData.data[0];
 
           let PassengerStartMonth = StudentData.data[0].ed_transport_passenger_startMonth * 1;
 
           let StudentClassData = await axios.get(FORMURL[6] + StudentData.data[0].ed_student_class);
           setPassengerStudentCode(StudentData.data[0].ed_student_id);
 
           if (StudentClassData.data.length >= 1) {
             let AcademicYearData = await axios.get(FORMURL[7] + StudentClassData.data[0].ed_class_year);
 
             INPUTS.transportpayment_academic_year = StudentClassData.data[0].ed_class_year;
             setField("transportpayment_academic_year", StudentClassData.data[0].ed_class_year);
 
             if (AcademicYearData.data.length >= 1) {
               let CurrentAcademicYearData = AcademicYearData.data[0];
 
               let M1 = CurrentAcademicYearData.ed_academic_year_startDate.split('-')[1] * 1;
               let M2 = CurrentAcademicYearData.ed_academic_year_endDate.split('-')[1] * 1;
               let Y1 = CurrentAcademicYearData.ed_academic_year_startDate.split('-')[0] * 1;
               let Y2 = CurrentAcademicYearData.ed_academic_year_endDate.split('-')[0] * 1;
 
               let CurrentMonthsOptions = [];
               const push = (mIndex, year) => {
                 if (mIndex >= PassengerStartMonth) {
                   CurrentMonthsOptions.push({ label: (MonthsList[mIndex] + " de " + year), selected: false, value: ((mIndex + "." + year) * 1) });
                 }
               };
 
               if (Y2 > Y1) {
                 for (let i = (M1 - 1); i <= 11; i++) push(i, Y1);
                 for (let i = 0; i <= (M2 - 1); i++) push(i, Y2);
               } else {
                 for (let i = (M1 - 1); i <= (M2 - 1); i++) push(i, Y1);
               }
 
               setMonthOptions(CurrentMonthsOptions);
               setPaymentMonths(CurrentMonthsOptions);
             }
           }
         }
       } catch (error) {
         toast.error("Lamentamos mas não foi  possivel executar esta ação !");
         setRegisterStatus(1);
       }
     }
 
     await GetStudentData();
     setStudentCode(e);       // passageiro id (na tua API)
     setPassengerCode(e);     // passageiro id
     setField("transportpayment_student_code", e);
     ServiceData(serviceCode, 1, e);
   };
 
   // abrir por pop externo
   useEffect(() => {
     if (SH) handleShow();
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [props.pop])
 
   // quando abrir modal, aplica prefill (se existir)
   useEffect(() => {
     if (!show) return;
     if (!prefill) return;
     // dá um pequeno tempo para inputs existirem
     const t = setTimeout(() => applyPrefillOnOpen(), 50);
     return () => clearTimeout(t);
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [show]);
 
   const handleInput = (e) => {
     switch (e.target.id) {
       case "transportpayment_months":
         StaticMonths = e.target.value;
         INPUTS.transportpayment_months = e.target.value
         setField("transportpayment_months", e.target.value);
         SetMonths(e.target.value);
         break;
 
       case "transportpayment_servicecode":
         if (StaticMonths === '') { StaticMonths = Months };
         setServiceCode(Math.floor(e.target.value));
         setField("transportpayment_servicecode", e.target.value);
         INPUTS.transportpayment_servicecode = e.target.value
         setTimeout(() => {
           if (serviceCode !== null) ServiceData(e.target.value, Select.length, studentCode);
         }, 300);
         break;
 
       case "transportpayment_type":
         setPaymentType(Math.floor(e.target.value * 1));
         setField("transportpayment_type", e.target.value);
         INPUTS.transportpayment_type = e.target.value
         if (e.target.value * 1 >= 0) {
           if (e.target.value * 1 !== 0) {
             INPUTS.transportpayment_place = "";
             INPUTS.transportpayment_bank = "";
             INPUTS.transportpayment_bordereux_number = "";
             setField("transportpayment_bordereux_number", "");
             setField("transportpayment_place", "");
             setField("transportpayment_bank", "");
           }
         }
         break;
 
       case "transportpayment_balance":
         setField("transportpayment_balance", e.target.value);
         INPUTS.transportpayment_balance = e.target.value
         break;
 
       case "transportpayment_invoice":
         setField("transportpayment_invoice", e.target.value);
         INPUTS.transportpayment_invoice = e.target.value
         break;
 
       case "transportpayment_bank":
         setField("transportpayment_bank", e.target.value);
         INPUTS.transportpayment_bank = e.target.value
         break;
 
       case "transportpayment_place":
         setField("transportpayment_place", e.target.value);
         INPUTS.transportpayment_place = e.target.value
         break;
 
       case "transportpayment_bordereux_number":
         setField("transportpayment_bordereux_number", e.target.value);
         INPUTS.transportpayment_bordereux_number = e.target.value;
         break;
 
       default:
     }
   }
 
   return (
     <div>
       <div onClick={handleShow}>
         {props.toggle_btn ? props.toggle_btn : <button className='btn btn-main bg-main'><AddCircleOutlineIcon />Efetuar pagamento do transporte</button>}
       </div>
 
       <AnimatedModal content={
         <Modal size='lg' className={showBox ? ModalAnimationShow() : ModalAnimationClose()}
           centered dialogAs={DraggableModal} show={show} onHide={handleClose}>
           <Modal.Header closeButton>
             <Modal.Title>
               <div className="ed-wrap align-center">
                 <UserOptionDropDown />
                 <h5>{props.title ? props.title : 'Efetuar '} pagamento do transporte</h5>
               </div>
             </Modal.Title>
           </Modal.Header>
 
           <Form onSubmit={FormSubmit}>
             <Modal.Body className='scrollLimit'> 
               {props.update ? (
                 <>
                   {Founded === null ? (
                     <LoaderContainer>
                       <Loader absolute small />
                     </LoaderContainer>
                   ) : (
                     <>
                       {!Founded ? (
                         <EmptyBox>
                           <NotFounded />
                         </EmptyBox>
                       ) : (
                         <div>
                           {/* update UI mantida (como teu original) */}
                         </div>
                       )}
                     </>
                   )}
                 </>
               ) : (
                 <div>
                   {/* PASSAGEIRO */}
                   <Form.Group className="mb-3">
                     <div className="ed-space">
                       <div>
                         <Form.Label>Nome do passageiro  <span className='text-danger ml-2'>*</span></Form.Label>
                       </div>
                       <div className='ed-flex'>
                         {PassengerStudentCode !== null ? <StudentDetailsMenu student_id={PassengerStudentCode} toggle_btn={<div className='btn-pm-info'><InfoOutlined /></div>} /> : <></>}
                       </div>
                     </div>
 
                     <div className={`select-search-item  ${errors.transportpayment_student_code ? 'error' : ''}`}>
                       <SelectSearch
                         onChange={(e) => GetStudentCode(e)}
                         value={studentCode}
                         options={PassengersArray()[0]}
                         search={true}
                         placeholder="Selecione um passageiro"
                         disabled={prefillLock("lockStudent")}
                       />
                     </div>
                     <small className="text-danger">{errors.transportpayment_student_code}</small>
                   </Form.Group>
 
                   {/* SERVIÇO */}
                   <Form.Group className="mb-3">
                     <Form.Label>Serviço<span className="text-danger ml-2">*</span></Form.Label>
                     <Form.Select
                       onChange={handleInput}
                       className={!!errors.transportpayment_servicecode && 'is-invalid'}
                       value={form.transportpayment_servicecode}
                       isInvalid={!!errors.transportpayment_servicecode}
                       id="transportpayment_servicecode"
                       disabled={prefillLock("lockService") || false}
                     >
                       <ServiceDataOptions />
                     </Form.Select>
                     <Form.Control.Feedback type='invalid'>{errors.transportpayment_servicecode}</Form.Control.Feedback>
 
                     <div>
                       {serviceCode === null ? <div></div> : (
                         <div className='mt-2'>
                           <Badge className='bg-main'>
                             <div className="ed-flex">
                               Valor do serviço :
                               <div className="ml-1"><GetServicePrice ID={serviceCode} /></div>
                             </div>
                           </Badge>
                         </div>
                       )}
                     </div>
                   </Form.Group>
 
                   {/* MESES (mantém MultiSelect, mas aceita prefill) */}
                   {PaymentMonths.length === 0 ? null : (
                     <Form.Group className="mb-3">
                       <Form.Label>Mês a pagar<span className="text-danger ml-2">*</span></Form.Label>
                       <MultiSelect
                         options={PaymentMonths}
                         value={Select}
                         className={errors.transportpayment_months ? 'border-red' : ''}
                         onChange={selectedMonths}
                         labelledBy='select'
                         disableSearch={false}
                         disabled={prefillLock("lockMonths")}
                       />
                       {errors.transportpayment_months !== null ? (
                         <small className="text-danger">
                           {errors.transportpayment_months * 1 >= 0 ? "O mês de " + GetPaidMonth(errors.transportpayment_months) + " Já foi pago" : errors.transportpayment_months}
                         </small>
                       ) : null}
                     </Form.Group>
                   )}
 
                   {/* METODO */}
                   <Form.Group>
                     <div className="mt-2">
                       <div className="block">
                         <Form.Label>Metodo de pagamento </Form.Label>
                         <Form.Select
                           onChange={handleInput}
                           className={!!errors.transportpayment_type && 'is-invalid'}
                           value={PaymentType}
                           isInvalid={!!errors.transportpayment_type}
                           id="transportpayment_type"
                         >
                           <option disabled selected>Selecionar metodo de pagamento...</option>
                           <option value="0" selected={CurrentPaymentMethod === 0 ? true : false}>Dinheiro a mão</option>
                           <option value="1" selected={CurrentPaymentMethod === 1 ? true : false}>Transferência</option>
                           <option value="2" selected={CurrentPaymentMethod === 2 ? true : false}>Depósito</option>
                           <option value="3" selected={CurrentPaymentMethod === 3 ? true : false}>TPA</option>
                         </Form.Select>
                         <Form.Control.Feedback type='invalid'>{errors.transportpayment_type}</Form.Control.Feedback>
                       </div>
 
                       <div className={PaymentType !== null && PaymentType !== 0 ? "block" : "d-none"}>
                         <div className="block mt-4">
                           <Form.Label>Nº de Referência</Form.Label>
                           <Form.Control type="text" onChange={handleInput}
                             className={!!errors.transportpayment_bordereux_number && 'is-invalid'}
                             value={form.transportpayment_bordereux_number}
                             isInvalid={!!errors.transportpayment_bordereux_number}
                             id="transportpayment_bordereux_number"
                           />
                           <Form.Control.Feedback type='invalid'>{errors.transportpayment_bordereux_number}</Form.Control.Feedback>
                         </div>
 
                         <div className="block mt-4">
                           <Form.Label>Nome do banco </Form.Label>
                           <Form.Control type="text" onChange={handleInput}
                             className={!!errors.transportpayment_bank && 'is-invalid'}
                             value={form.transportpayment_bank}
                             isInvalid={!!errors.transportpayment_bank}
                             id="transportpayment_bank"
                           />
                           <Form.Control.Feedback type='invalid'>{errors.transportpayment_bank}</Form.Control.Feedback>
                         </div>
 
                         <div className="block mt-4">
                           <Form.Label>Local de pagamento</Form.Label>
                           <Form.Control type="text" onChange={handleInput}
                             className={!!errors.transportpayment_place && 'is-invalid'}
                             value={form.transportpayment_place}
                             isInvalid={!!errors.transportpayment_place}
                             id="transportpayment_place"
                           />
                           <Form.Control.Feedback type='invalid'>{errors.transportpayment_place}</Form.Control.Feedback>
                         </div>
                       </div>
                     </div>
                   </Form.Group>
 
                   {/* FICHEIROS */}
                   {CurrentFiles.length >= 1 ? (
                     <div>
                       <BoxContainerBorder className='boxItem mt-4'>
                         <h2 className="title">Ficheiros anexados</h2>
                         <ul className='student-file-cp'>
                           {CurrentFiles.map((item, index) => (
                             <li className='student-file-el' id={`student-file-el-${index}`} key={index}>
                               <div className="ed-space">
                                 <div className="ed-flex">
                                   <div className="icon"><HiOutlineDocumentText /></div>
                                   <div className="block">
                                     <div className="title text-main"><ReduceTextLength text={item.ed_file_name} length={window.width >= 1300 ? 80 : 50} /></div>
                                     <div className="ed-flex">
                                       <div className="date text-dark"><AccessTimeOutlined /><span>{item.ed_file_register_date}</span></div>
                                       | <div className="size text-dark">{NumberToBytes(item.ed_file_size)}</div>
                                     </div>
                                   </div>
                                 </div>
                                 <div className="delete">
                                   <DeleteModal
                                     remove_element={`#student-file-el-${index}`}
                                     title='este ficheiro'
                                     url={Hoot() + `eduallfiledelete/delete/${item.ed_file_id}`}
                                     message='Ficheiro deletada com sucesso'
                                     toggle_btn={<div className="btn-circle bg-danger ml-2 text-light"><DeleteOutline /></div>}
                                   />
                                 </div>
                               </div>
                             </li>
                           ))}
                         </ul>
                       </BoxContainerBorder>
                     </div>
                   ) : null}
 
                   <div className="mt-2">
                     <FormControlLabel onChange={() => showBoxFile()} control={<Checkbox />} label="Anexar recibos de pagamento" />
                   </div>
 
                   <BoxContainerBorder className={Docfile === true ? 'boxItem' : 'boxItem d-none'} >
                     <h2 className="title">Carregar Recibo de pagamento</h2>
                     <FileUpload
                       input_name="transportpayment_files"
                       Icon="0"
                       type_of_files="image/x-png,image/gif,image/jpeg,Docs/pdf,application/vnd.openxmlformats-officedocument.wordprocessingml.document, application/pdf"
                       extensions="pdf, docx, png, jpeg, jpg"
                       Files={GetFiles}
                       ref={ChildRef}
                     />
                   </BoxContainerBorder>
 
                   {Docfile === true ? <br /> : null}
                 </div>
               )}
             </Modal.Body>
 
             <Modal.Footer>
               <div className="ed-space">
                 <div className={props.update ? (Founded === false ? "d-none" : "ed-wrap") : "ed-wrap"}>
                   <TX className="mt-1"><h4>Desconto : ({serviceDiscount})%</h4> {ApplyDiscount ? <div className="yes"><Check /></div> : <div className="no"><Close /></div>}</TX>
                   <TX className="mt-1">
                     <h4 className="ml-2">Multa : ({serviceFine}  {serviceFineType === 1 ? serviceCoin : ''} {(NonePaidMonths <= 1 ? '' : " * " + NonePaidMonths)})
                       {serviceFineType === 0 ? '%' : <span className="text-red"> Valor fixo</span>}
                     </h4>
                     {ApplyFine ? <div className="yes"><Check /></div> : <div className="no"><Close /></div>}
                   </TX>
                   <TX className="mt-1"><h4 className="ml-2">IVA : ({serviceIva})%</h4>
                     {serviceIva * 1 > 0 ? <div className="yes"><Check /></div> : <div className="no"><Close /></div>}
                   </TX>
                 </div>
               </div>
 
               <div className="ed-space">
                 <div className={props.update ? (Founded === false ? "d-none" : "ed-flex") : "ed-flex"}>
                   <h5 className='m-0'>Total :</h5>
                   <Form.Control readOnly disabled value={InvoiceValue} id="transportpayment_balance" className='text-danger ml-2' style={{ maxWidth: "180px" }} />
                 </div>
 
                 <div className="ed-flex">
                   <Button className='bg-light text-dark' onClick={handleClose}> Cancelar </Button>
                   <SaveButton
                     icon={props.title ? <Update /> : <MonetizationOn />}
                     title={props.title ? props.title : 'Pagar'}
                     status={RegisterStatus}
                   />
                 </div>
               </div>
             </Modal.Footer>
           </Form>
         </Modal>
       } />
     </div>
   )
 }
 
 const TX = styled.div`
   display:flex;
   align-items:center;
   margin-right:20px;
 
   .yes svg{
     width:20px;
     height:20px;
     fill:var(--ed-green);
     margin:0px;
   }
 
   .no svg{
     width:20px;
     height:20px;
     fill:var(--ed-red);
   }
 
   h4{
     font-size:16px;
     margin:0px;
     margin-right:5px;
     font-weight:600;
   }
 `;
 
 const BoxContainerBorder = styled.div`  
   width:auto;
   border-radius:6px;
   margin:10px 0;
   padding:20px;
   min-height:200px;
   background:var(--ed-white);  
   border:1px solid var(--ed-silver-light); 
 
   .ed-flex{
     margin-bottom:0px;
   }
 
   h2.title{
     font-size:18px; 
     text-transform:uppercase;
     font-weight:600;
     margin-top:10px;
     margin-bottom:25px;
   }
 `;
 
  
 
 const LoaderContainer = styled.div`
   width:100%;
   min-height:300px;
   padding:30px;
   display:flex;
   align-items:center;
   justify-content:center; 
 `;
 
 const EmptyBox = styled.div`
      min-height:300px;
      padding:40px;
      width:100%;
      display:flex;
      align-items:center;
      justify-content:center; 
 
        img{
            max-height:200px;
        }
 `;
 
 export default NewTransportPaymentsModal
 


 import React, { useEffect, useMemo, useRef, useState } from 'react'
 import styled from 'styled-components'
 import { Button, Form, Alert as BsAlert } from 'react-bootstrap'
 import { InfoOutlined, Search, Close } from '@mui/icons-material';
 import { Avatar, Checkbox as MuiCheckbox } from '@mui/material';
 import { Link } from 'react-router-dom';
 import axios from 'axios';
 import Hoot from '../../../General/components/Hoot';
 import EmptyImage from '../../../Assets/images/svg/personal_info.svg';
 import SwitchFromPages from '../../../General/components/SwitchFromPages';
 import Loader from '../../../General/components/Loader';
 import StudentDetailsMenu from '../../components/elements/StudentDetailsMenu';
 import NotFounded from '../../../General/components/NotFounded';
 import KeyboardEventHandler from 'react-keyboard-event-handler';
 import SmallPassengersGrid from '../../components/Grid/SmallPassengersGrid';
 import { BsClock } from "react-icons/bs";
 import TransportPaymentsTable from '../../components/Table/TransportPaymentsTable';
 import NewTransportPaymentsModal from '../../components/modal/NewTransportPaymentsModal';
 import { useLocation, useHistory } from 'react-router-dom';
 import { RiRfidLine, RiBankCardLine } from "react-icons/ri";
 
 function TransportPayments() {
   document.title = "Pagar transporte escolar";
 
   const ChildRef = useRef();
 
   const navigate = useHistory();
   const { search } = useLocation();
   const searchParams = new URLSearchParams(search);
   const Year = searchParams.get("year");
   const Studentid = searchParams.get("student");
 
   const [StudentClass, setStudentClass] = useState('#');
   const [StudentName, setStudentName] = useState('#');
   const [StudentDataInfo, setStudentDataInfo] = useState({});
   const [StudentPicture, setStudentPicture] = useState('#');
   const [StudentId, setStudentId] = useState('#');
 
   const [AcademicYear, setAcademicyear] = useState(null);
 
   const [ShowMonths, setShowMonths] = useState(false);
   const [StudentClassFilter, setStudentClassFilter] = useState(null);
   const [StudentNameFilter, setStudentNameFilter] = useState(null);
 
   const [StudentPassengerStartMonth, SetStudentPassengerStartMonth] = useState("");
   const [StudentPassengerAcademicYearTitle, SetStudentPassengerAcademicYearTitle] = useState("");
 
   const [PopStatus, setPopStatus] = useState(false);
   const [MP, SM] = useState([]);
   const [Founded, setFounded] = useState('');
 
   // ====== AUTO RFID SCAN ======
   const rfidInputRef = useRef(null);
   const [rfidStatus, setRfidStatus] = useState("active"); // active | reading
   const [rfidAlert, setRfidAlert] = useState({
     show: true,
     type: "info",
     msg: "Pode encostar o cartão RFID do aluno para carregar automaticamente os dados do transporte e mensalidades do ano lectivo atual."
   });
   const [rfidError, setRfidError] = useState(null);
 
   //  FIX: capturar RFID mesmo quando o input invisível perde foco
   const rfidBufferRef = useRef("");
   const rfidTimerRef = useRef(null);
 
   // ===== Pagamento rápido (seleção de meses) =====
   const [selectedMonthsQuick, setSelectedMonthsQuick] = useState([]); // {label,value}
   const [quickPayOpen, setQuickPayOpen] = useState(false);
 
   const MonthsList = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
 
   const normalizeId = (v) => {
     const n = Number(v);
     return Number.isFinite(n) && n > 0 ? n : 0;
   };
 
   const focusRFID = () => rfidInputRef.current?.focus();
 
   const GetStudentPaymentData = (a, b) => {
     navigate.push(`/transportpayments?student=${a}&year=${b}`);
   };
 
   const LoadByParams = (a, b) => {
     if (normalizeId(a) >= 1 && normalizeId(b) >= 1) {
       GetPaymentData(a, b);
       setAcademicyear(normalizeId(b));
     }
   };
 
   useEffect(() => {
     LoadByParams(Studentid, Year);
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, [Year, Studentid]);
 
   // reset seleção ao trocar aluno/ano
   useEffect(() => {
     setSelectedMonthsQuick([]);
     setQuickPayOpen(false);
   }, [StudentId, AcademicYear]);
 
   //  FIX PRINCIPAL: garantir leitura RFID sempre (captura global + foco)
   useEffect(() => {
     const onGlobalPointerDown = (e) => {
       const el = e.target;
       const ignore =
         el.closest?.('.modal') ||
         el.closest?.('.select-search') ||
         el.closest?.('.select-search-container') ||
         el.closest?.('.rmsc') ||
         el.closest?.('input') ||
         el.closest?.('textarea') ||
         el.closest?.('select') ||
         el.closest?.('[role="listbox"]') ||
         el.closest?.('[role="dialog"]');
 
       if (!ignore) focusRFID();
     };
 
     // Captura global do teclado: leitores RFID normalmente "digitam" rápido + Enter/Tab
     const onGlobalKeyDown = (e) => {
       // não interferir em inputs/selects/textareas/modais
       const tag = (e.target?.tagName || "").toLowerCase();
       if (tag === "input" || tag === "textarea" || tag === "select" || e.target?.isContentEditable) return;
 
       // se for Enter/Tab: tenta finalizar
       if (e.key === "Enter" || e.key === "Tab") {
         const code = (rfidBufferRef.current || "").trim();
         if (code.length > 0) {
           rfidBufferRef.current = "";
           clearTimeout(rfidTimerRef.current);
           GetPaymentDataByRFID(code);
         }
         return;
       }
 
       // acumular apenas caracteres "digitáveis"
       if (e.key && e.key.length === 1) {
         rfidBufferRef.current += e.key;
 
         // reset buffer se parar de "digitar" por ~250ms (comum em leitores)
         clearTimeout(rfidTimerRef.current);
         rfidTimerRef.current = setTimeout(() => {
           rfidBufferRef.current = "";
         }, 250);
       }
     };
 
     // foco inicial
     focusRFID();
 
     window.addEventListener("pointerdown", onGlobalPointerDown, true);
     window.addEventListener("keydown", onGlobalKeyDown, true);
 
     return () => {
       window.removeEventListener("pointerdown", onGlobalPointerDown, true);
       window.removeEventListener("keydown", onGlobalKeyDown, true);
       clearTimeout(rfidTimerRef.current);
     };
     // eslint-disable-next-line react-hooks/exhaustive-deps
   }, []);
 
   const FilterData = (a, e) => {
     a === 1 ? setStudentNameFilter(e.target.value) : setStudentClassFilter(e.target.value);
     ChildRef.current.ChangeFilter(a === 1 ? 1 : 0);
   };
 
   const handleKeys = (k) => {
     switch (k) {
       case "p":
         setPopStatus(true);
         break;
       case "r":
         focusRFID();
         break;
       default:
     }
   };
 
   const buildMonths = (startDate, endDate) => {
     if (!startDate || !endDate || !startDate.includes("-") || !endDate.includes("-")) return [];
 
     const [Y1, M1] = startDate.split("-").map(Number);
     const [Y2, M2] = endDate.split("-").map(Number);
     const months = [];
 
     const pushMonth = (m, y) => months.push({
       month: `${MonthsList[m - 1]} de ${y}`,
       code: parseFloat(`${m}.${y}`),
       status: "other"
     });
 
     if (Y2 > Y1) {
       for (let i = M1; i <= 12; i++) pushMonth(i, Y1);
       for (let i = 1; i <= M2; i++) pushMonth(i, Y2);
     } else {
       for (let i = M1; i <= M2; i++) pushMonth(i, Y1);
     }
 
     return months;
   };
 
   const applyStatus = (months, payments, passengerStartMonth, yearStartYear) => {
     const now = new Date();
     const currentYear = now.getFullYear();
     const currentMonth = now.getMonth() + 1;
 
     const paidSet = new Set(
       (payments || [])
         .filter(p => p?.ed_transport_payment_month !== "" && p?.ed_transport_payment_month !== null && p?.ed_transport_payment_month !== undefined)
         .map(p => parseFloat(p.ed_transport_payment_month))
     );
 
     const canceledSet = new Set(
       (payments || [])
         .filter(p => p?.ed_transport_payment_status === "canceled" && p?.ed_transport_payment_month !== "" && p?.ed_transport_payment_month !== null && p?.ed_transport_payment_month !== undefined)
         .map(p => parseFloat(p.ed_transport_payment_month))
     );
 
     const startM = passengerStartMonth !== null && passengerStartMonth !== undefined ? parseInt(passengerStartMonth) : null;
     const startY = yearStartYear ? parseInt(yearStartYear) : null;
 
     return months.map(m => {
       const [mMonth, mYear] = m.code.toString().split(".").map(Number);
 
       // meses antes do ingresso no transporte (no ano de inicio)
       if (startM !== null && startY && mYear === startY && mMonth < (startM + 1)) {
         return { ...m, status: "null" };
       }
 
       if (canceledSet.has(m.code)) return { ...m, status: "canceled" };
       if (paidSet.has(m.code)) return { ...m, status: "paid" };
 
       if (mYear < currentYear || (mYear === currentYear && mMonth < currentMonth)) {
         return { ...m, status: "notpaid" };
       }
 
       return { ...m, status: "other" };
     });
   };
 
   const GetPaymentData = async (studentCode, Academic_year) => {
     const studentId = normalizeId(studentCode);
     const yearId = normalizeId(Academic_year);
 
     if (!studentId || !yearId) {
       setFounded(false);
       return;
     }
 
     try {
       setFounded(null);
 
       const [AcademicYearData, passengerRes, paymentsRes] = await Promise.all([
         axios.get(`${Hoot()}eduallsingleacademicyearapi/get/${yearId}`, { withCredentials: true }),
         axios.get(`${Hoot()}edualltransportsinglepassengerget/get/${studentId}`, { withCredentials: true }),
         axios.get(`${Hoot()}eduallsinglestudenttransportpayment/get/${studentId},${yearId}`, { withCredentials: true })
       ]);
 
       if (!Array.isArray(AcademicYearData.data) || AcademicYearData.data.length < 1) {
         setFounded(false);
         return;
       }
 
       const yearData = AcademicYearData.data[0];
 
       if (Array.isArray(passengerRes.data) && passengerRes.data.length >= 1) {
         const p = passengerRes.data[0];
         setStudentDataInfo(p);
         setStudentName(p.ed_student_name);
         setStudentClass(p.ed_student_class);
         setStudentPicture(p.ed_student_picture);
         setStudentId(p.ed_student_id);
 
         const startMonthIndex = (p.ed_transport_passenger_startMonth * 1);
         SetStudentPassengerStartMonth(MonthsList[startMonthIndex] || "");
         SetStudentPassengerAcademicYearTitle(p.ed_academic_year_title || "");
       }
 
       const months = buildMonths(yearData.ed_academic_year_startDate, yearData.ed_academic_year_endDate);
       const yearStartYear = yearData.ed_academic_year_startDate?.split("-")[0];
 
       const passengerStartMonth = Array.isArray(passengerRes.data) && passengerRes.data.length >= 1
         ? passengerRes.data[0].ed_transport_passenger_startMonth
         : null;
 
       const monthsStatus = applyStatus(months, paymentsRes.data || [], passengerStartMonth, yearStartYear);
 
       SM(monthsStatus);
       setShowMonths(true);
       setFounded(monthsStatus.length >= 1);
     } catch (error) {
       setFounded(false);
     }
   };
 
   const GetPaymentDataByRFID = async (rfidCode) => {
     const code = (rfidCode || "").trim();
     if (!code) return;
 
     try {
       setFounded(null);
       setRfidStatus("reading");
       setRfidError(null);
 
       try {
         await axios.post(`${Hoot()}eduallrfid/log/register`, { code }, { withCredentials: true });
       } catch (_) { }
 
       const url = `${Hoot()}eduallsinglestudenttransportpayment/get/rfid/${encodeURIComponent(code)}`;
       const response = await axios.get(url, { withCredentials: true });
 
       if (response?.data?.success && response.data.data) {
         const payload = response.data.data;
 
         const student = payload.student || {};
         const passenger = payload.passenger || {};
         const payments = payload.payments || [];
 
         setStudentName(student.name || "#");
         setStudentClass(student.class_id || "#");
         setStudentPicture(student.picture || "#");
         setStudentId(student.id || "#");
 
         setAcademicyear(student.academic_year || null);
 
         const startMonthIndex = passenger.startMonth !== null && passenger.startMonth !== undefined ? (passenger.startMonth * 1) : null;
         SetStudentPassengerStartMonth(startMonthIndex !== null ? (MonthsList[startMonthIndex] || "") : "");
         SetStudentPassengerAcademicYearTitle(student.year_title || "");
 
         const yearId = normalizeId(student.academic_year);
         const yearRes = await axios.get(`${Hoot()}eduallsingleacademicyearapi/get/${yearId}`, { withCredentials: true });
 
         if (!Array.isArray(yearRes.data) || yearRes.data.length < 1) {
           SM([]);
           setShowMonths(false);
           setFounded(false);
           setRfidStatus("active");
           return;
         }
 
         const yearData = yearRes.data[0];
         const months = buildMonths(yearData.ed_academic_year_startDate, yearData.ed_academic_year_endDate);
         const yearStartYear = yearData.ed_academic_year_startDate?.split("-")[0];
 
         const monthsStatus = applyStatus(months, payments, passenger.startMonth, yearStartYear);
 
         SM(monthsStatus);
         setShowMonths(true);
         setFounded(monthsStatus.length >= 1);
 
         if (yearId && student.id) {
           navigate.push(`/transportpayments?student=${student.id}&year=${yearId}`);
         }
       } else {
         setFounded(false);
       }
 
       setRfidStatus("active");
     } catch (error) {
       setFounded(false);
       setRfidStatus("active");
       setRfidError(error?.response?.data?.msg || error?.response?.data?.message || error?.message || "Erro ao processar cartão RFID.");
     }
   };
 
   //  mantém também a leitura pelo input (quando está focado)
   const handleRFIDKey = async (e) => {
     if (e.key !== "Enter" && e.key !== "Tab") return;
 
     const code = e.target.value.trim();
     if (!code) return;
 
     e.target.value = "";
     await GetPaymentDataByRFID(code);
   };
 
   const rfidBtnClass = rfidStatus === "reading" ? "bg-warning" : "bg-green";
   const rfidBtnLabel = rfidStatus === "reading" ? "RFID: Lendo..." : "RFID: Activo";
 
   const canSelectMonth = (status) => status === "notpaid" || status === "other";
 
   const toggleQuickMonth = (m) => {
     const code = String(m.code);
     const label = String(m.month || code);
     const exists = selectedMonthsQuick.some(x => String(x.value) === code);
 
     if (exists) {
       setSelectedMonthsQuick(arr => arr.filter(x => String(x.value) !== code));
     } else {
       setSelectedMonthsQuick(arr => [...arr, { label, value: code }]);
     }
   };
 
   const clearQuickSelection = () => setSelectedMonthsQuick([]);
 
   const quickPayPrefill = useMemo(() => {
     const sid = normalizeId(StudentId);
     const year = normalizeId(AcademicYear);
     if (!sid || !year || selectedMonthsQuick.length === 0) return null;
 
     return {
       studentId: sid,
       academicYearId: year,
       months: selectedMonthsQuick.map(m => ({ label: m.label, value: Number(m.value) })),
       lockStudent: true,
       lockMonths: true,
       lockAcademicYear: true
     };
   }, [StudentId, AcademicYear, selectedMonthsQuick]);
 
   return (
     <div className='feespayments'>
       <KeyboardEventHandler handleKeys={['p', 'r']} onKeyEvent={(key) => handleKeys(key)} />
 
       {/* input invisível RFID */}
       <input
         ref={rfidInputRef}
         type="text"
         onKeyDown={handleRFIDKey}
         autoComplete="off"
         autoCorrect="off"
         spellCheck={false}
         style={{
           opacity: 0,
           position: "absolute",
           width: "1px",
           height: "1px",
           left: 0,
           top: 0,
           zIndex: -1
         }}
       />
 
       {/* alert RFID */}
       {rfidAlert?.show ? (
         <div className="mb-2">
           <BsAlert variant={rfidAlert.type || "info"} className="py-2 mb-0 d-flex align-items-start justify-content-between">
             <div style={{ fontSize: 13 }}>
               <RiRfidLine style={{ marginRight: 6, transform: "translateY(-1px)" }} />
               {rfidAlert.msg}
             </div>
             <div
               role="button"
               onClick={() => setRfidAlert((s) => ({ ...s, show: false }))}
               style={{ opacity: 0.7 }}
               title="Fechar"
             >
               <Close fontSize="small" />
             </div>
           </BsAlert>
         </div>
       ) : null}
 
       {rfidError ? (
         <div className="mb-2">
           <BsAlert variant="danger" className="py-2 mb-0 d-flex align-items-start justify-content-between">
             <div style={{ fontSize: 13 }}>
               {rfidError}
             </div>
             <div
               role="button"
               onClick={() => setRfidError(null)}
               style={{ opacity: 0.7 }}
               title="Fechar"
             >
               <Close fontSize="small" />
             </div>
           </BsAlert>
         </div>
       ) : null}
 
       <div className="ed-space mb-3">
         <div className="ed-block">
           <Form>
             <div className="search-box boxItem">
               <Form.Group>
                 <div className="ed-flex m0 fill">
                   <Search />
                   <div className="block col ml-2">
                     <Form.Control type="text" onChange={(e) => FilterData(1, e)} placeholder="Pesquisar ..." autoFocus />
                   </div>
                 </div>
               </Form.Group>
             </div>
           </Form>
         </div>
 
         <div className="ed-flex">
           <NewTransportPaymentsModal pop={PopStatus} />
 
           <Button
             className={`btn-small ed-flex ml-2 text-light ${rfidBtnClass}`}
             onClick={focusRFID}
             title="RFID está sempre ativo (atalho: R)"
           >
             <RiRfidLine style={{ marginRight: 6 }} />
             {rfidBtnLabel}
           </Button>
         </div>
       </div>
 
       <div className="ed-flex" style={{ alignItems: 'flex-start' }}>
         <FilterBox className='filterBox'>
           <Box className='boxItem'>
             <div className="title">Selecione um passageiro</div>
             <Container>
               <SmallPassengersGrid
                 ref={ChildRef}
                 FilterByName={StudentNameFilter}
                 FilterByClass={StudentClassFilter}
                 GetData={GetStudentPaymentData}
               />
             </Container>
           </Box>
         </FilterBox>
 
         <div className="pd-1"></div>
 
         <Box className='ml-2 boxItem'>
           {Founded === '' ? (
             <div className='empty-search'>
               <img loading="lazy" role="presentation" src={EmptyImage} alt="selecione um estudante" />
               <div className="mt-3 text-center">
                 <div className="grey-text" style={{ fontSize: 14 }}>
                   <RiRfidLine style={{ marginRight: 8, transform: "translateY(-1px)" }} />
                   <RiBankCardLine style={{ marginRight: 8, transform: "translateY(-1px)" }} />
                   Pode encostar o cartão RFID do aluno para carregar automaticamente o transporte.
                 </div>
                 <div className="grey-text mt-1" style={{ fontSize: 12 }}>
                   O sistema usa o ano lectivo atual associado ao aluno.
                 </div>
               </div>
             </div>
           ) : (
             <>
               {Founded === null ? (
                 <LoaderContainer>
                   <Loader absolute small />
                 </LoaderContainer>
               ) : (
                 <>
                   {Founded === false ? (
                     <NotFounded />
                   ) : (
                     <>
                       <div className="ed-space">
                         <div className="ed-flex mb-4 ed-wrap">
                           <li className="ed-flex ex"><div className="dot success"></div> Pago</li>
                           <li className="ed-flex ex"><div className="dot warning"></div>Não pago</li>
                           <li className="ed-flex ex"><div className="dot danger"></div> Anulado</li>
                           <li className="ed-flex ex"><div className="dot other"></div> Outras</li>
                         </div>
                         <div className="ed-flex" style={{ marginRight: '10px' }}>
                           {(StudentId !== "#" && StudentId !== null) ?
                             <StudentDetailsMenu student_id={StudentId} toggle_btn={<div className='btn-pm-info'><InfoOutlined /></div>} />
                             : null}
                         </div>
                       </div>
 
                       <div className="startmonthh ed-flex text-main">
                         <BsClock />
                         <div className="ml-2 ed-flex">
                           Mês de ingresso ao transporte - {StudentPassengerStartMonth} ({StudentPassengerAcademicYearTitle})
                         </div>
                       </div>
 
                       <div className="ed-flex">
                         <SwitchFromPages link={`studentinfo/${StudentId}`}
                           menu='3' menu_item='17' toggle_btn={
                             <Link to="#">
                               <Avatar
                                 alt={StudentName}
                                 className='df'
                                 src={StudentPicture !== "#" ? Hoot() + StudentPicture : ""}
                                 sx={{ width: 106, height: 106 }}
                               />
                             </Link>
                           } />
                         <div className="d-block ml-2 description">
                           <SwitchFromPages link={`studentinfo/${StudentId}`}
                             menu='3' menu_item='17' toggle_btn={
                               <h5 className='name'>Nome : <Link to="#" className='text-main label-student-name'> {StudentName} </Link></h5>
                             } />
                           <div className="ed-wrap ed-flex">
                             <h5 className='ed-flex'>Turma :
                               <Link to='#' className='text-main label-student-class ml-1'>{StudentDataInfo.ed_class_title || "—"}</Link>
                             </h5>
                             <h5 className='ed-flex ml-2'>Nº de matrícula :
                               <Link to='#' className='text-main label-student-class ml-1'>{StudentDataInfo.ed_student_code || "—"}</Link>
                             </h5>
                           </div>
                         </div>
                       </div>
 
                       <h2>Mensalidades do transporte</h2>
 
                       {selectedMonthsQuick.length > 0 ? (
                         <div className="ed-flex mt-2" style={{ gap: 14, flexWrap: "wrap" }}>
                           <span
                             role="button"
                             className="quick-action clear"
                             onClick={clearQuickSelection}
                           >
                             Limpar seleção
                           </span>
 
                           <span
                             role="button"
                             className="quick-action pay text-main"
                             onClick={() => setQuickPayOpen(true)}
                           >
                             Efetuar pagamento dos meses selecionados
                           </span>
                         </div>
                       ) : (
                         <div className="grey-text mt-2" style={{ fontSize: 12 }}>
                           Clique nos meses <strong>não pagos</strong> ou <strong>outras</strong> para selecionar e pagar.
                         </div>
                       )}
 
                       {quickPayOpen && quickPayPrefill ? (
                         <NewTransportPaymentsModal
                           pop={quickPayOpen}
                           onClose={() => setQuickPayOpen(false)}
                           prefill={quickPayPrefill}
                           title="Efetuar"
                         />
                       ) : null}
 
                       <div className="wrap wrap-scroll">
                         {ShowMonths === true ? (
                           MP.map((item, index) => {
                             const selectable = canSelectMonth(item.status);
                             const checked = selectedMonthsQuick.some(x => String(x.value) === String(item.code));
 
                             return (
                               <div
                                 key={index}
                                 className={
                                   item.status === ''
                                     ? 'month'
                                     : `month ${item.status} ${selectable ? "selectable" : ""} ${checked ? "selected" : ""}`
                                 }
                                 onClick={() => {
                                   if (!selectable) return;
                                   toggleQuickMonth(item);
                                 }}
                                 title={selectable ? "Clique para selecionar" : ""}
                                 role={selectable ? "button" : undefined}
                               >
                                 {selectable ? (
                                   <div className="month-check">
                                     <MuiCheckbox
                                       checked={checked}
                                       size="small"
                                       onChange={() => { }}
                                       sx={{
                                         pointerEvents: "none",
                                         color: "#111",
                                         "&.Mui-checked": { color: "#111" },
                                         "& .MuiSvgIcon-root": { fontSize: 18 }
                                       }}
                                     />
                                   </div>
                                 ) : null}
 
                                 <div className="month-label">{item.month}</div>
                               </div>
                             );
                           })
                         ) : null}
                       </div>
                     </>
                   )}
                 </>
               )}
             </>
           )}
         </Box>
       </div>
 
       <div className="mt-4">
         <TransportPaymentsTable />
       </div>
     </div>
   )
 }
 
 export default TransportPayments
 
 const FilterBox = styled.div`
   max-width:400px;
   min-width:400px;
 
   .title{
     font-weight: 600;
     font-size: 18px;
     margin-bottom:10px;
   }
 `;
 
 const Box = styled.div`
   width:100%;
   border-radius:6px;
   padding:20px;
   min-height:520px;
   height:auto;
   background:var(--ed-white);
   box-shadow:var(--ed-shadow-df);
   margin:10px 0;
   position:relative;
   overflow:hidden;
 
   .startmonthh{
     margin-bottom:15px;
     svg{
       width:35px;
       height:35px;
     }
   }
 
   .wrap-scroll{
     overflow-y:auto;
     max-height:180px;
     padding-right:20px;
     padding-left:10px;
     margin-left:-10px;
 
     &::-webkit-scrollbar{
       width:6px !important;
       background-color:transparent !important;
     }
 
     &::-webkit-scrollbar-thumb{
       background:rgb(219, 219, 219) !important;
     }
   }
 
   .empty-search{
     display:flex;
     flex-direction:column;
     align-items:center;
     justify-content:center;
     height:100%;
     min-height:440px;
 
     img{
       max-width:600px;
       max-height:300px;
     }
   }
 
   @media screen and (max-width:1290px){
     width:auto;
     min-width:50%;
     min-height:550px;
   }
 
   .ex{
     font-size:16px;
     margin-top:8px;
     margin-right:25px;
 
     .dot{
       width:20px;
       height:20px;
       border-radius:100%;
       margin-right:10px;
       border:3px solid var(--ed-white);
       box-shadow:var(--ed-shadow-df);
     }
 
     .dot.warning{ background:#FFBD00; }
     .dot.success{ background:#52B69A; }
     .dot.other{ background:#CED4DA; }
     .dot.danger{ background:var(--ed-red-light); }
   }
 
   .description{
     .name{
       font-size:18px;
       margin-bottom:15px;
       margin-top:10px;
     }
     h5{
       font-size:16px;
     }
   }
 
   h2{
     margin:10px 0;
     font-size:18px;
     font-weight:600;
   }
 
   .quick-action{
     font-size:12px;
     font-weight:700;
     cursor:pointer;
     user-select:none;
   }
 
   .quick-action.clear{
     color:#6b7280;
     text-decoration:none;
     padding:5px 12px;
     border-radius:999px;
     border:1px dashed #d1d5db;
     background:#fff;
   }
 
   .quick-action.clear:hover{
     opacity:0.88;
   }
 
   .quick-action.pay{
     text-decoration:underline;
   }
 
   .month{
     display:flex;
     align-items:center;
     gap:8px;
     padding:8px 10px;
     border-radius:10px;
     margin:6px 8px 0 0;
     font-size:13px;
     border:1px solid #e5e7eb;
     user-select:none;
     position:relative;
   }
 
   .month.selectable{
     cursor:pointer;
   }
 
   .month.selected{
     box-shadow: 0 0 0 2px rgba(14,165,233,0.12);
   }
 
   .month .month-check{
     display:flex;
     align-items:center;
     justify-content:center;
     margin-left:-6px;
   }
 
   .month .month-check .MuiCheckbox-root{
     padding:0px !important;
   }
 
   .month .month-label{
     flex:1;
     white-space:nowrap;
   }
 
   .month.paid{
     border-color:#52B69A;
     box-shadow: 0 0 0 2px rgba(82,182,154,0.12);
   }
 
   .month.notpaid{
     border-color:#FFBD00;
     box-shadow: 0 0 0 2px rgba(255,189,0,0.12);
   }
 
   .month.other{
     border-color:#CED4DA;
     opacity:0.85;
   }
 
   .month.canceled{
     border-color:var(--ed-red-light);
     box-shadow: 0 0 0 2px rgba(255,0,0,0.08);
   }
 
   .month.null{
     opacity:0.35;
     pointer-events:none;
   }
 `;
 
 const Container = styled.ul`
   width:100%;
   max-height:430px;
   min-height:430px;
   overflow-y:auto;
   padding:0px;
   padding-right:10px;
 
   .empty-search{
     display:flex;
     align-items:center;
     justify-content:center;
     height:100%;
     min-height:440px;
 
     img{
       max-width:600px;
       max-height:300px;
     }
   }
 
   @media screen and (max-width:1280px){
     max-height:400px;
   }
 
   &::-webkit-scrollbar{
     width:6px;
     background-color:transparent;
   }
 
   &:hover{
     &::-webkit-scrollbar-thumb{
       background:#eaeaee;
     }
   }
 `;
 
 const LoaderContainer = styled.div`
   position:absolute;
   top:0px;
   left:0px;
   width:100%;
   height:100%;
   padding:30px;
   display:flex;
   align-items:center;
   justify-content:center;
 `;
 
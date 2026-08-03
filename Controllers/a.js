/*
ao abrir o PopPaymentDetailsModal no StudentFeePayments ele exibee mal o valor tipo 54.0000 aonvez de ser 51.000, e nao parec todos os detalhes como aparaceee no FeespaymentsTable.

code do StudentFeePayments para reparação:

import React, { useState, useEffect } from 'react';
import axios from 'axios';
import Hoot from '../../../General/components/Hoot';
import DeleteModal from '../elements/DeleteModal';
import TableGrid from '../../../General/components/TableGrid';
import NumberToPrice from '../../../General/components/NumberToPrice';
import PopPaymentDetailsModal from '../modal/PopPaymentDetailsModal';
import RefreshButton from '../../../General/components/RefreshButton';
import { DeleteButton, PreviewButton } from '../../../General/components/Buttons/TableButtons';
import DownloadInvoicePDFButton from '../../../General/components/DownloadInvoicePDFButton';
import { PiFilePdfDuotone, PiMicrosoftExcelLogoDuotone } from 'react-icons/pi';
import { ExportDataToTablesToPdf } from '../../../General/components/ExportDataToTablesToPdf';
import ExportDataForTablesExcel from '../../../General/components/ExportDataForTablesExcel';
import moment from 'moment';

const Months = [
  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
];

const columns = [
  { field: 'invoiceN', headerName: 'Nº da Fatura', width: 180, searchMap: row => row.invoiceN },
  { field: 'service', headerName: 'Serviço', width: 260, searchMap: row => row.service },
  { field: 'monthsLabel', headerName: 'Meses pagos', width: 220, searchMap: row => row.monthsLabel },
  {
    field: 'price',
    headerName: 'Preçário',
    width: 160,
    cellRenderer: (props) => (
      <div>{NumberToPrice(props.data.price)} {props.data.coin}</div>
    ),
    searchMap: row => `${NumberToPrice(row.price)} ${row.coin}`
  },
  {
    field: 'total',
    headerName: 'Total',
    width: 160,
    cellRenderer: (props) => (
      <div>{NumberToPrice(props.data.balance)} {props.data.coin}</div>
    ),
    searchMap: row => `${NumberToPrice(row.balance)} ${row.coin}`
  },
  {
    field: 'situation',
    headerName: 'Situação',
    width: 150,
    cellRenderer: (props) =>
      props.data.invoiceCount > 1
        ? <div className="badge col-lg-12 bg-warning">{props.data.invoiceCount} meses</div>
        : <div className="badge col-lg-12 bg-success">PG. Simples</div>,
    searchMap: row => row.invoiceCount > 1 ? `${row.invoiceCount} meses` : "PG. Simples"
  },
  { field: 'date', headerName: 'Data do pagamento', width: 250, searchMap: row => row.date },
  {
    field: 'action',
    headerName: 'Ação',
    width: 250,
    cellRenderer: (props) => (
      <div className="ed-flex">
        <DownloadInvoicePDFButton documentId={props.data.code} />
        <PopPaymentDetailsModal
          payment={props.data}
          studentGet={Hoot() + `eduallsinglestudentapi/get/${props.data.student}`}
          print={`/student_tuition_payment_print_invoice/${props.data.id}`}
          toggle_btn={<PreviewButton />}
        />
        <DeleteModal
          title='pagamento(s) da fatura'
          urlsArray={props.data.paymentsUrls}
          message='Pagamento(s) deletado(s) com sucesso!'
          toggle_btn={<DeleteButton />}
        />
      </div>
    ),
    searchMap: () => ""
  }
];

function StudentFeePayments({ data: studentData }) {
  const [data, setData] = useState([]);
  const [loaded, setLoaded] = useState(false);
  const [loadStatus, setLoadStatus] = useState(null);

  const DATAURL = [
    Hoot() + 'eduallsinglestudentfeepayment/get/', // agora retorna extras
    Hoot() + 'eduallsingleacademicyearapi/get/',
    Hoot() + 'eduallsingleclassapi/get/'
  ];

  function computeLine(item) {
    const price = item.ed_fee_payment_price * 1;
    const discountPct = item.ed_fee_payment_discount * 1 || 0;
    const ivaPct = item.ed_fee_payment_iva * 1 || 0;
    const fineType = item.ed_fee_payment_fineType * 1 || 0;
    const fineValue = item.ed_fee_payment_fineValue * 1 || 0;

    const afterDiscount = price - (price * discountPct) / 100;
    const base = ivaPct > 0 ? afterDiscount / (1 + ivaPct / 100) : afterDiscount;
    const fineAmount = fineType === 1 ? fineValue : (base * fineValue) / 100;
    const total = afterDiscount + fineAmount;

    return { total };
  }

  async function loadData() {
    setLoaded(false);
    try {
      setLoadStatus(0);
      if (!studentData) return;

      const studentId = studentData.ed_student_id;
      const classRes = await axios.get(DATAURL[2] + studentData.ed_student_class);
      if (classRes.data.length < 1) return;

      const year = classRes.data[0].ed_class_year;
      const payRes = await axios.get(`${DATAURL[0]}${studentId},${year}`);
      if (!Array.isArray(payRes.data) || payRes.data.length < 1) return;

      const grouped = {};

      payRes.data.forEach((item) => {
        const { total } = computeLine(item);
        const key = item.ed_fee_payment_invoiceCode;
        const deleteUrl = Hoot() + `eduallfeepaymentsdelete/delete/${item.ed_fee_payment_id}`;

        const extrasArray = item.extras ? JSON.parse(item.extras) : [];
        const extrasTotal = Array.isArray(extrasArray)
          ? extrasArray.reduce((sum, ex) => sum + (Number(ex.amount) || 0), 0)
          : 0;

        if (!grouped[key]) {
          grouped[key] = {
            id: item.ed_fee_payment_id,
            invoiceN: item.ed_fee_payment_invoiceCode,
            service: item.ed_service_title,
            coin: item.ed_coin_code,
            code: item.ed_fee_payment_invoiceFile,
            student: item.ed_fee_payment_student,
            name: item.ed_student_name,
            balance: total,
            price: item.ed_fee_payment_price,
            months: [item.ed_fee_payment_month],
            invoiceCount: 1,
            date: moment(item.ed_fee_payment_registerDate).format('DD [de] MMMM [de] YYYY [às] HH:mm'),
            paymentsUrls: [deleteUrl],
            extras: extrasArray,
            extrasTotal,
            extrasAdded: false
          };
        } else {
          grouped[key].balance += total;
          grouped[key].months.push(item.ed_fee_payment_month);
          grouped[key].invoiceCount += 1;
          grouped[key].paymentsUrls.push(deleteUrl);
        }

        if (!grouped[key].extrasAdded && extrasTotal > 0) {
          grouped[key].balance += extrasTotal;
          grouped[key].extrasTotal = extrasTotal;
          grouped[key].extrasAdded = true;
        }
      });

      const rows = Object.values(grouped).map((g, index) => ({
        ...g,
        index: index + 1,
        monthsLabel: g.months
          .map((m) => {
            if (!m) return "";
            const [mm, yy] = m.split(".");
            const monthIndex = parseInt(mm, 10);
            const monthName = !isNaN(monthIndex) && monthIndex >= 0 && monthIndex <= 11
              ? Months[monthIndex]
              : mm;
            return `${monthName} de ${yy}`;
          })
          .filter(Boolean)
          .join(", "),
      }));

      setData(rows);
      setLoadStatus(2);
    } catch (err) {
      console.error("Erro ao carregar pagamentos:", err);
      setLoadStatus(1);
    } finally {
      setLoaded(true);
    }
  }

  useEffect(() => {
    loadData();
  }, []);

  return (
    <div id="ed-custom-table-data">
      <TableGrid
        TableHead={columns}
        TableBody={data}
        TableTitle={`Propinas pagas (${studentData?.ed_student_name || ""})`}
        TableBtn={
          <div className='ed-flex'>
            <button id='ed-custom-table-data-btn'
              onClick={() =>
                ExportDataToTablesToPdf({
                  fileName: "Pagamentos do aluno",
                  contentId: "ed-custom-table-data",
                  rotation: "landscape",
                  customHeader: "Lista de Pagamentos do aluno",
                  excludedColumns: ["Ação"]
                })
              }
              className='btn-icon ed-flex ed-center btn btn-export-data ml-2 bg-white'>
              <PiFilePdfDuotone />
            </button>
            <button
              className='btn-icon btn btn-export-data ml-2'
              onClick={() => ExportDataForTablesExcel("Pagamentos do aluno", ["Ação"])}
            >
              <PiMicrosoftExcelLogoDuotone />
            </button>
            <RefreshButton action={loadData} status={loadStatus} />
          </div>
        }
      />
      <br />
    </div>
  );
}

export default StudentFeePayments;



code do FeespaymentsTable para conparação :


import React, { useState, useEffect } from 'react'
import axios from 'axios'
import { Delete, Edit } from '@mui/icons-material';
import Hoot from '../../../General/components/Hoot';
import DeleteModal from '../elements/DeleteModal';
import NewfeeManualPaymentModal from '../modal/NewfeeManualPaymentModal';
import SwitchFromPages from '../../../General/components/SwitchFromPages';
import TableGrid from '../../../General/components/TableGrid';
import NumberToPrice from '../../../General/components/NumberToPrice';
import { Avatar } from '@mui/material';
import PopPaymentDetailsModal from '../modal/PopPaymentDetailsModal';
import { DeleteButton, EditButton, PreviewButton } from '../../../General/components/Buttons/TableButtons';
import RefreshButton from '../../../General/components/RefreshButton';
import { ExportDataToTablesToPdf } from '../../../General/components/ExportDataToTablesToPdf';
import { PiFilePdfDuotone, PiMicrosoftExcelLogoDuotone } from 'react-icons/pi';
import ExportDataForTablesExcel from '../../../General/components/ExportDataForTablesExcel';
import moment from 'moment';
import DownloadInvoicePDFButton from '../../../General/components/DownloadInvoicePDFButton';

const TABLEURL = [Hoot() + "eduallfeepaymentsapi/get/", Hoot() + "eduallgetsingleinstitute/get/1"];
const Months = ["Janeiro", "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho",
  "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];

const columns = [
  {
    field: 'invoiceN',
    headerName: 'Nº da Fatura',
    width: 200,
    searchMap: row => row.invoiceN
  },
  {
    field: 'student',
    headerName: 'Nome do aluno',
    width: 350,
    cellRenderer: (props) => {
      return (
        <SwitchFromPages link={`studentinfo/${props.data.student}`}
          menu='3' menu_item='17'
          toggle_btn={
            <div className='ed-flex'>
              <Avatar
                className='df'
                alt={props.data.name}
                src={props.data.picture !== "" ? Hoot() + props.data.picture : ""}
              />
              <span className='ml-2'>(#{props.data.studentcode}) - {props.data.name}</span>
            </div>
          }
        />
      )
    },
    searchMap: row => row.name
  },
  {
    field: 'service',
    headerName: 'Titulo do serviço',
    width: 250,
    searchMap: row => row.service
  },
  {
    field: 'month',
    headerName: 'Mês pago',
    width: 180,
    cellRenderer: (props) => {
      return <div className="tb-item">
        {props.data.monthsLabel}
      </div>
    },
    searchMap: row => row.monthsLabel
  },
  {
    field: 'price',
    headerName: 'Preçario',
    width: 160,
    cellRenderer: (props) => {
      return <div className='ed-flex'>
        {NumberToPrice(props.data.price)} {props.data.coin}
      </div>
    },
    searchMap: row => `${NumberToPrice(row.price)} ${row.coin}`
  },
  {
    field: 'total',
    headerName: 'Total',
    width: 180,
    cellRenderer: (props) => {
      return <div className='ed-flex'>
        {NumberToPrice(props.data.balance)} {" " + props.data.coin}
      </div>
    },
    searchMap: row => `${NumberToPrice(row.balance)} ${row.coin}`
  },
  {
    field: 'situation',
    headerName: 'Situação',
    width: 150,
    cellRenderer: (props) => {
      return (
        props.data.invoiceCount > 1 ?
          <div className="badge col-lg-12 bg-warning">{props.data.invoiceCount} meses</div> :
          <div className="badge col-lg-12 bg-success">PG. Simples</div>
      )
    },
    searchMap: row => row.invoiceCount > 1 ? `${row.invoiceCount} meses` : "PG. Simples"
  },
  {
    field: 'date',
    headerName: 'Data de pagamento',
    width: 250,
    searchMap: row => row.date
  },
  {
    field: 'action',
    headerName: 'Ação',
    width: 320,
    cellRenderer: (props) => {
      return (
        <div className="ed-flex">
          <div className="d-none">
            <NewfeeManualPaymentModal
              title='Atualizar ' update='true'
              get={Hoot() + `eduallfeepaymentsingle/get/${props.data.id}`}
              url={Hoot() + `eduallfeepaymentupdate/update/${props.data.id}`}
              toggle_btn={<EditButton />}
            />
          </div>
          <div className="tb-item">
            <DownloadInvoicePDFButton documentId={props.data.code} />
          </div>
          {/* Agora passamos os dados do pagamento via props.payment
              e o fetch de aluno via studentGet */}
          <PopPaymentDetailsModal
            payment={props.data}
            studentGet={Hoot() + `eduallsinglestudentapi/get/${props.data.student}`}
            filesGetPrefix={Hoot() + "eduallsingleuserfiles/get/"}
            print={`/student_tuition_payment_print_invoice/${props.data.id}`}
            toggle_btn={<PreviewButton />}
          />
          <DeleteModal
            title='pagamento(s) da fatura'
            urlsArray={props.data.paymentsUrls} // array de URLs para deleção
            message='Pagamento(s) deletado(s) com sucesso!'
            toggle_btn={<DeleteButton />}
          />
        </div>
      );
    },
    searchMap: () => ""
  }
];

function FeespaymentsTable() {
  const [data, setData] = useState([]);
  const [load, setLoaded] = useState(false);
  const [LoadStatus, setLoadStatus] = useState(null);

  function computeLine(item) {
    const price = item.ed_fee_payment_price * 1;
    const discountPct = item.ed_fee_payment_discount * 1 || 0;
    const ivaPct = item.ed_fee_payment_iva * 1 || 0;
    const fineType = item.ed_fee_payment_fineType * 1 || 0;
    const fineValue = item.ed_fee_payment_fineValue * 1 || 0;

    // preço já inclui IVA no teu modelo atual; primeiro aplica desconto
    const afterDiscount = price - (price * discountPct) / 100;
    const base = ivaPct > 0 ? afterDiscount / (1 + ivaPct / 100) : afterDiscount;
    const ivaAmount = afterDiscount - base;
    const fineAmount = fineType === 1 ? fineValue : (base * fineValue) / 100;
    const total = afterDiscount + fineAmount;

    return { base, ivaAmount, fineAmount, total, afterDiscount };
  }

  
    async function loadData() {
      setLoaded(false);
      try {
        setLoadStatus(0);
        const response = await axios.get(TABLEURL[0]); // API já retorna .extras

        // Agrupar por código de fatura (invoice)
        const grouped = {};
        response.data.forEach((item) => {
          const { base, ivaAmount, fineAmount, total, afterDiscount } = computeLine(item);
          const key = item.ed_fee_payment_invoiceCode;

          const deleteUrl = Hoot() + `eduallfeepaymentsdelete/delete/${item.ed_fee_payment_id}`;

          const paymentLine = {
            id: item.ed_fee_payment_id,
            month: item.ed_fee_payment_month,
            service: item.ed_service_title,
            price: item.ed_fee_payment_price * 1,
            discount: item.ed_fee_payment_discount * 1,
            iva: item.ed_fee_payment_iva * 1,
            fineType: item.ed_fee_payment_fineType * 1,
            fineValue: item.ed_fee_payment_fineValue * 1,
            method: item.ed_fee_payment_type * 1,
            registerDate: item.ed_fee_payment_registerDate,
            coin: item.ed_coin_code,
            base,
            ivaAmount,
            fineAmount,
            total,
            afterDiscount,
            paymentCode: item.ed_fee_payment_code,
            invoiceFile: item.ed_fee_payment_invoiceFile
          };

          // Calcular total de extras associados (se existirem)
          const extrasArray = item.extras ? JSON.parse(item.extras) : [];
          const extrasTotal = Array.isArray(extrasArray)
            ? extrasArray.reduce((sum, ex) => sum + (Number(ex.amount) || 0), 0)
            : 0;

          if (!grouped[key]) {
            // 🔹 Cria nova fatura
            grouped[key] = {
              id: item.ed_fee_payment_id,
              service: item.ed_service_title,
              coin: item.ed_coin_code,
              code: item.ed_fee_payment_invoiceFile,
              paymentCode: item.ed_fee_payment_code,
              student: item.ed_fee_payment_student,
              name: item.ed_student_name,
              studentcode: item.ed_student_code,
              picture: item.ed_student_picture,
              months: [item.ed_fee_payment_month],
              balance: total, // ⚠️ NÃO adicionamos extras aqui
              extrasTotal,    // Armazenamos, mas somaremos 1x fora do loop
              price: item.ed_fee_payment_price,
              invoiceN: item.ed_fee_payment_invoiceCode,
              date: moment(item.ed_fee_payment_registerDate).format('DD [de] MMMM [de] YYYY [às] HH:mm'),
              invoiceCount: 1,
              paymentsUrls: [deleteUrl],
              payments: [paymentLine],
              extras: extrasArray,
              extrasAdded: false // marcador de controle
            };
          } else {
            // 🔹 Já existe: acumula o total do pagamento
            grouped[key].balance += total;
            grouped[key].months.push(item.ed_fee_payment_month);
            grouped[key].invoiceCount += 1;
            grouped[key].paymentsUrls.push(deleteUrl);
            grouped[key].payments.push(paymentLine);
          }

          // 🔹 Adiciona extras uma única vez por fatura
          if (!grouped[key].extrasAdded && extrasTotal > 0) {
            grouped[key].balance += extrasTotal;
            grouped[key].extrasTotal = extrasTotal;
            grouped[key].extras = extrasArray;
            grouped[key].extrasAdded = true;
          }
        });

        // Converter em array e formatar labels
        const rows = Object.values(grouped).map((g, index) => ({
          ...g,
          index: index + 1,
          monthsLabel: g.months
            .map((m) => {
              if (!m) return "";
              let mm, yy, monthName;
              if (m.includes(".")) {
                [mm, yy] = m.split(".");
                const monthIndex = parseInt(mm, 10);
                const Months = [
                  "Janeiro","Fevereiro","Março","Abril","Maio","Junho",
                  "Julho","Agosto","Setembro","Outubro","Novembro","Dezembro"
                ];
                monthName =
                  !isNaN(monthIndex) && monthIndex >= 0 && monthIndex <= 11
                    ? Months[monthIndex]
                    : mm;
              } else if (m.includes("-")) {
                const parts = m.split("-");
                monthName = parts[0] || "";
                yy = parts[1] || "";
              } else {
                monthName = m;
                yy = "";
              }
              return `${monthName} de ${yy}`;
            })
            .filter(Boolean)
            .join(", "),
        }));

        setData(rows);
        setTimeout(() => setLoaded(true), 200);
        setLoadStatus(2);
      } catch (error) {
        console.error("Erro ao carregar pagamentos:", error);
        setLoaded(true);
        setLoadStatus(1);
      }
    }



  useEffect(() => {
    loadData();
  }, []);

  if (load) {
    return (
      <div id="ed-custom-table-data">
        <TableGrid
          TableHead={columns}
          TableBody={data}
          TableTitle='Propinas pagas'
          TableBtn={
            <div className='ed-flex' >
              <button id='ed-custom-table-data-btn'
                onClick={() =>
                  ExportDataToTablesToPdf({
                    fileName: "Lista dos pagamentos de propinas",
                    headerId: null,
                    contentId: "ed-custom-table-data",
                    footerId: null,
                    rotation: "landscape",
                    buttonId: "ed-custom-table-data-btn",
                    customHeader: "Lista dos pagamentos de propinas",
                    excludedColumns: ["Ação"]
                  })
                }
                className='btn-icon ed-flex ed-center btn btn-export-data ml-2 bg-white'><PiFilePdfDuotone />
              </button>
              <button className='btn-icon btn btn-export-data ml-2'
                onClick={() => ExportDataForTablesExcel("Lista dos pagamentos de propinas", ["Ação"])}><PiMicrosoftExcelLogoDuotone />
              </button>
              <RefreshButton action={loadData} status={LoadStatus} />
            </div>}
        />
        <br />
      </div>
    )
  } else {
    return (
      <div>
        <div className="d-none">*</div>
        <TableGrid
          TableHead={columns}
          TableBody={[]}
          TableTitle='Propinas pagas'
          TableBtn={<RefreshButton action={loadData} status={LoadStatus} />}
        />
        <br />
      </div>
    )
  }
}

export default FeespaymentsTable





dados que vem ao sleciona no FeespaymentsTable ao abrir o popupmodal (correto):
Nome : Francisca Mateus Guilherme
Turma : POLR




Classe : 8ª Classe
Sala : 16
Período : Tarde
Curso : Telecomunicação e eletronica

    Nº da Fatura :
    FT 01P2025/340
    Código do documento :
    293901202
    Data & Hora :
    02 de novembro de 2025 às 09:33
    Serviço principal :
    Propina geral
    Meses :
    Fevereiro de 2022, Março de 2022

    Detalhe por mês/serviço
    Mês: Fevereiro de 2022
    Serviço: Propina geral
    Preço: 24.000,00 AOA
    Desc.: 0% (0,00 AOA)
    Base: 24.000,00 AOA
    IVA: 0,00 AOA (0%)
    Multa: 0,00 AOA
    Método: Dinheiro a mão
    Total linha: 24.000,00 AOA
    Mês: Março de 2022
    Serviço: Propina geral
    Preço: 24.000,00 AOA
    Desc.: 0% (0,00 AOA)
    Base: 24.000,00 AOA
    IVA: 0,00 AOA (0%)
    Multa: 0,00 AOA
    Método: Dinheiro a mão
    Total linha: 24.000,00 AOA

    Serviços adicionais incluídos
    Descrição: Multa
    Valor: 2.000,00 AOA
    Data: 2025-11-02 09:33
    Descrição: Valor extra
    Valor: 1.000,00 AOA
    Data: 2025-11-02 09:33
    Base:
    48.000,00 AOA
    IVA:
    0,00 AOA
    Multas:
    0,00 AOA
    Extras:
    3.000,00 AOA
    Total Fatura:
    51.000,00 AOA



dados que vem no StudentFeePayments  ao abrir o popupmodal (errado)

Nome : Francisca Mateus Guilherme
Turma : POLR




Classe :
Sala :
Período :
Curso :

    Nº da Fatura :
    FT 01P2025/340
    Código do documento :
    293901202
    Data & Hora :
    02 de novembro de 2025 às 09:33
    Serviço principal :
    Propina geral
    Meses :
    Fevereiro de 2022, Março de 2022

    Serviços adicionais incluídos
    Descrição: Multa
    Valor: 2.000,00
    Data: 2025-11-02 09:33
    Descrição: Valor extra
    Valor: 1.000,00
    Data: 2025-11-02 09:33
    Base:
    0,00
    IVA:
    0,00
    Multas:
    0,00
    Extras:
    3.000,00
    Total Fatura:
    54.000,00 




*/




import React, {useState, useEffect} from 'react'; 
import {Modal} from 'react-bootstrap';
import styled from "styled-components";
import DraggableModal from '../../../General/components/DraggableModal';
import { Avatar } from '@mui/material';
import { Link } from 'react-router-dom';
import { DeleteOutline, DownloadingOutlined } from '@mui/icons-material';
import Hoot from '../../../General/components/Hoot';
import axios from 'axios';
import UserOptionDropDown from '../elements/UserOptionDropDown';
import SwitchFromPages from '../../../General/components/SwitchFromPages';
import { GetAcademiclevel_byclass, GetClassroom_byclass, GetClasstitle_byclass, GetCourse_byclass, GetPeriod_byclass } from '../../../General/components/InstituteData';
import moment from 'moment';
import NumberToPrice from '../../../General/components/NumberToPrice';
import ReduceTextLength from '../../../General/components/ReduceTextLength';
import DeleteModal from '../elements/DeleteModal';
import { HiOutlineDocumentText } from 'react-icons/hi';
import { AccessTimeOutlined} from '@mui/icons-material';
import { ModalAnimationClose, ModalAnimationShow } from '../../../General/components/ModalAnimations';
import ReplaceWord from '../../../General/components/ReplaceWord';
import DownloadInvoicePDFButton from '../../../General/components/DownloadInvoicePDFButton';

const PaymentMethods = ["Dinheiro a mão", "Transferência", "Depósito"];

function PopPaymentDetailsModal(props) {
  const { payment, studentGet, filesGetPrefix } = props;
  const [show, setShow] = useState(false); 
  const [showBox, SetshowBox]  = useState(false);
  const [Student, setStudent] = useState({});
  const [CurrentFiles, SetCurrentFiles] = useState([]);
  const [Totals, setTotals] = useState({
    base: 0, ivaAmount: 0, fineAmount: 0, afterDiscount: 0, total: 0, extrasTotal: 0
  });

  const handleClose = () => {
    SetshowBox(false);
    setTimeout(() => setShow(false), 1200);
  };

  const handleShow = () => {
    SetshowBox(true);
    setShow(true);
  };

  useEffect(() => {
    if (!show) return;

    // Buscar aluno
    (async () => {
      try {
        if (studentGet) {
          const r = await axios.get(studentGet);
          if (r?.data) {
            const st = Array.isArray(r.data) ? r.data[0] : r.data;
            setStudent(st || {});
          }
        }
      } catch (e) {}
    })();

    // Buscar anexos
    (async () => {
      try {
        if (filesGetPrefix && payment?.paymentCode) {
          const rf = await axios.get(`${filesGetPrefix}${payment.paymentCode}`);
          SetCurrentFiles(Array.isArray(rf.data) ? rf.data : []);
        }
      } catch (e) {}
    })();

    // Calcular totais
    let agg = { base: 0, ivaAmount: 0, fineAmount: 0, afterDiscount: 0, total: 0, extrasTotal: 0 };
    if (payment?.payments?.length) {
      agg = payment.payments.reduce((acc, p) => {
        acc.base += p.base || 0;
        acc.ivaAmount += p.ivaAmount || 0;
        acc.fineAmount += p.fineAmount || 0;
        acc.afterDiscount += p.afterDiscount || 0;
        acc.total += p.total || 0;
        return acc;
      }, agg);
    } else {
      agg.total = payment?.balance || 0;
    }

    // Incluir extras
    if (Array.isArray(payment?.extras) && payment.extras.length > 0) {
      const extrasTotal = payment.extras.reduce((sum, e) => sum + (Number(e.amount) || 0), 0);
      agg.extrasTotal = extrasTotal;
      agg.total += extrasTotal;
    }

    setTotals(agg);
  }, [show, studentGet, filesGetPrefix, payment]);

  return (
    <div> 
      <div onClick={handleShow}>
        { props.toggle_btn ? props.toggle_btn : <button className='btn btn-main bg-main'>Ver detalhes</button> }
      </div>

      <Modal
        size='lg'
        centered
        className={showBox ? ModalAnimationShow() : ModalAnimationClose()}
        dialogAs={DraggableModal}
        show={show}
        onHide={handleClose}
      >
        <Modal.Header closeButton>
          <Modal.Title>
            <div className="ed-wrap align-center">
              <UserOptionDropDown />
              <div className="ed-block">
                <h5 className='m0'>Detalhes do pagamento</h5>
                <small style={{marginTop:"-15px"}} className='text-danger m0 sm-text'>
                  {payment?.invoiceCount > 1 ? `${payment.invoiceCount} meses (Pagamento múltiplo)` : 'Pagamento simples'}
                </small>
              </div>
            </div>
          </Modal.Title>
        </Modal.Header>

        <Modal.Body className='scrollLimit'>
          {/* Cabeçalho do aluno */}
          <Box className="boxItem"> 
            <div className="ed-flex student-box"> 
              <SwitchFromPages link={`studentinfo/${payment?.student}`} menu='3' menu_item='17'
                toggle_btn={
                  <div className='ed-flex'>
                    <Avatar
                      alt={Student?.ed_student_name || payment?.name}
                      className='df'
                      src={Student?.ed_student_picture ? Hoot()+Student.ed_student_picture : (payment?.picture ? Hoot()+payment.picture : '')}
                      sx={{ width:90, height:90 }}
                    />
                  </div>
                }
              /> 
              <div className="d-block ml-2 description">
                <h3 className='name'>
                  Nome :{" "}
                  <Link to='#' className='text-main label-student-name'>
                    {Student?.ed_student_name || payment?.name}
                  </Link>
                </h3>
                <h5>
                  Turma :{" "}
                  <Link to='#' className='text-main label-student-class'>
                    <GetClasstitle_byclass ID={Student?.ed_student_class}/>
                  </Link>
                </h5>
              </div>
            </div>

            <br /><br /><br /><br />
            <div className="ed-flex mt-4 description">
              <h5>{ReplaceWord("Classe")} :{" "}
                <Link to='#' className='text-main label-student-level'>
                  <GetAcademiclevel_byclass ID={Student?.ed_student_class}/>
                </Link>
              </h5>
              <h5 className='ml-2'>Sala :{" "}
                <Link to='#' className='text-main label-student-classroom'>
                  <GetClassroom_byclass ID={Student?.ed_student_class}/>
                </Link>
              </h5>
              <h5 className='ml-2'>Período :{" "}
                <Link to='#' className='text-main label-student-class'>
                  <GetPeriod_byclass ID={Student?.ed_student_class}/>
                </Link>
              </h5>
            </div>
            <div className="ed-flex mt-2 description">
              <h5>Curso :{" "}
                <Link to='#' className='text-main label-student-class'>
                  <GetCourse_byclass ID={Student?.ed_student_class}/>
                </Link>
              </h5> 
            </div> 
          </Box>

          <br />

          {/* Metadados e detalhes */}
          <Main>
            <ul>
              <li><b>Nº da Fatura :</b> <div className="ml-2"><b>{payment?.invoiceN}</b></div></li>
              <li><b>Código do documento :</b> <div className="ml-2"><b>{payment?.code}</b></div></li>
              <li><b>Data & Hora :</b> <div className="ml-2"><b>{payment?.date}</b></div></li>
              <li><b>Serviço principal :</b> <div className="ml-2"><b>{payment?.service}</b></div></li>
              <li><b>Meses :</b> <div className="ml-2"><b>{payment?.monthsLabel}</b></div></li>

              {/* Detalhe por serviço/mês */}
              {Array.isArray(payment?.payments) && payment.payments.length > 0 && (
                <>
                  <br />
                  <strong className="text-dark mb-2">Detalhe por mês/serviço</strong>
                  <div className="student-file-cp">
                    {payment.payments.map((p, idx) => (
                      <li key={p.id || idx}>
                        <div className="ed-space" style={{width:'100%'}}>
                          <div className="ed-flex" style={{flexWrap:'wrap', gap:12}}>
                            <div><b>Mês:</b> {formatMonthLabel(p.month)}</div>
                            <div><b>Serviço:</b> {p.service}</div>
                            <div><b>Preço:</b> {NumberToPrice(p.price)} {p.coin}</div>
                            <div><b>Desc.:</b> {p.discount}% ({NumberToPrice((p.price*p.discount)/100)} {p.coin})</div>
                            <div><b>Base:</b> {NumberToPrice(p.base)} {p.coin}</div>
                            <div><b>IVA:</b> {NumberToPrice(p.ivaAmount)} {p.coin} ({p.iva}%)</div>
                            <div><b>Multa:</b> {NumberToPrice(p.fineAmount)} {p.coin}</div>
                            <div><b>Método:</b> {PaymentMethods[p.method] || '-'}</div>
                            <div><b>Total linha:</b> {NumberToPrice(p.total)} {p.coin}</div>
                          </div>
                        </div>
                      </li>
                    ))}
                  </div>
                </>
              )}

              {/*  Serviços adicionais */}
              {Array.isArray(payment?.extras) && payment.extras.length > 0 && (
                <>
                  <br />
                  <strong className="text-dark mb-2">Serviços adicionais incluídos</strong>
                  <div className="student-file-cp">
                    {payment.extras.map((ex, idx) => (
                      <li key={ex.id || idx}>
                        <div className="ed-flex" style={{flexWrap:'wrap', gap:12}}>
                          <div><b>Descrição:</b> {ex.description}</div>
                          <div><b>Valor:</b> {NumberToPrice(ex.amount)} {payment.coin}</div>
                          <div><b>Data:</b> {moment(ex.created_at).format("YYYY-MM-DD HH:mm")}</div>
                        </div>
                      </li>
                    ))}
                  </div>
                </>
              )}

              {/* Totais */}
              <div className="total mt-4">
                <div className="ed-space"><h1>Base:</h1><h1>{NumberToPrice(Totals.base)} {payment?.coin}</h1></div>
                <div className="ed-space"><h1>IVA:</h1><h1>{NumberToPrice(Totals.ivaAmount)} {payment?.coin}</h1></div>
                <div className="ed-space"><h1>Multas:</h1><h1>{NumberToPrice(Totals.fineAmount)} {payment?.coin}</h1></div>
                {Totals.extrasTotal > 0 && (
                  <div className="ed-space"><h1>Extras:</h1><h1>{NumberToPrice(Totals.extrasTotal)} {payment?.coin}</h1></div>
                )}
                <div className="ed-space border-top pt-2"><h1>Total Fatura:</h1><h1>{NumberToPrice(Totals.total)} {payment?.coin}</h1></div>
              </div>
            </ul>
          </Main>
        </Modal.Body>

        <Modal.Footer>
          <div className="ed-space col">
            <div></div>
            <div className="ed-center">
              <DownloadInvoicePDFButton toggle_btn documentId={payment?.code} /> 
            </div>
          </div>
        </Modal.Footer>
      </Modal>
    </div>
  )
}

function formatMonthLabel(m) {
  if (!m) return "";
  if (m.includes(".")) {
    const [mm, yy] = m.split(".");
    const idx = parseInt(mm, 10);
    const MonthOptions = ["Janeiro" , "Fevereiro", "Março", "Abril", "Maio", "Junho", "Julho", "Agosto", "Setembro", "Outubro", "Novembro", "Dezembro"];
    const name = (!isNaN(idx) && idx >=0 && idx <=11) ? MonthOptions[idx] : mm;
    return `${name} de ${yy || ""}`.trim();
  }
  if (m.includes("-")) {
    const [name, yy] = m.split("-");
    return `${name} de ${yy || ""}`.trim();
  }
  return m;
}

const Box = styled.div`
  width:100%; 
  border-radius:6px;   
  padding:0px 10px; 
  min-height:100px;  
  .student-box{
    position:absolute; left:0; top:0; width:100%;
    padding:10px 20px; background:var(--ed-background-color);
  }
  .description{
    .name{ font-size:18px; margin-bottom:15px; margin-top:10px; }
    h5{ font-size:16px; }
  }
`;

const Main = styled.main`
  ul{
    padding:0px; padding-left:10px;  
    li{
      padding:10px 0px;
      border-top:1px solid var(--ed-white-smoke);
      font-size:15px; font-weight:500;
      list-style:none; display:flex;
    }
    .total{
      padding:10px 0px;  
      border-top:4px double #000;
      border-bottom:4px double #000;
      h1{ font-size:18px; margin:0px; }
    }
  }
`;

export default PopPaymentDetailsModal;




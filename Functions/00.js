criar uma função que recebe 
a data de rewgsitro,  a bsoverção e o item , o obejcto client ser prendhi com os dadosd a instituiçãpo logadaatualmenete usando :

 
    try {
        const query = `SELECT * FROM eduall_institutes 
            LEFT JOIN eduall_institutes_licences ON eduall_institutes_licences.ed_institute_licence_instituteCode = eduall_institutes.ed_institute_code 
            WHERE ed_institute_deleted = 0 AND ed_institute_code = ?`;
        const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
        const result = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_institutes", type: "select", data: req });
        res.status(200).json(result);
    } catch (error) {
        res.status(500).json({ success: false, message: "Falha ao buscar o instituto atual!", error: error.message });
    }

    estrutra da tabela :


    ed_institute_id
ed_institute_name
ed_institute_principal
ed_institute_pedagogical_director
ed_institute_linkedin
ed_institute_facebook
ed_institute_instagram
ed_institute_youtube
ed_institute_country
ed_institute_address
ed_institute_nif
ed_institute_phone1
ed_institute_phone2
ed_institute_email
ed_institute_state
ed_institute_slogan
ed_institute_bank1
ed_institute_bank1_account_number
ed_institute_bank1_recipient
ed_institute_bank2
ed_institute_bank2_account_number
ed_institute_bank2_recipient
ed_institute_iva_value
ed_institute_website
ed_institute_description
ed_institute_docheader
ed_institute_logo
ed_institute_status
ed_institute_coverImage
ed_institute_code
ed_institute_language
ed_institute_type
ed_institute_deleted
ed_institute_registerDate
ed_institute_type1


no objeto document onde diz currency, o valo ddevera vir databela das moedas da esocla :

try {
    const query = 'SELECT * FROM eduall_coins WHERE ed_coin_deleted = 0 AND ed_coin_institute_code = ?';
    const PARAMS = [req.session.user.eduall_user_session_curentinstitute];
    const rows = await ExecuteQuery(res, query, PARAMS, true, { db: "eduall_coins", type: "select", data: req });
    res.status(200).json(rows);
} catch (error) {
    res.status(500).json({ success: false, message: "Failed to fetch coins!", error: error.message });
}
cada escola tem apenas um registro de modea, esturutra d atabela de moedas:
ed_coin_id  
ed_coin_title  
ed_coin_value_in_euro  
ed_coin_value_in_dollar  
ed_coin_exchange_value  
ed_coin_tax  
ed_coin_tax_value  
ed_coin_iva  
ed_coin_code  
ed_coin_institute_code  
ed_coin_deleted  
ed_coin_registerDat

o cmapo a pegar é o ed_coin_code.BODY
a função devera retiprnar uma onjeto similara a este :
 


const BODY = {
    document: {
      type: 'factura',
      date: '2025-05-14',
      duedate: '2025-05-20',
      vref: 'XPTO001',
      serie: '2025',
      currency: 'AOA',
      exchange_rate: '0',
      observation: 'Nome do estudante : kiosso andre',
      retention: '6.5'
    },
    client: {
      name: 'Cliente Teste',
      nif: '123456789',
      email: 'cli@exemplo.com',
      city: 'Luanda',
      address: 'Rua Exemplo',
      postalcode: '',
      country: 'Angola'
    },
    items: [
      { itemcode: 'IT001', description: 'Produto A', price: '9500', quantity: '2', tax: '14', discount: '0' }
    ]
  };
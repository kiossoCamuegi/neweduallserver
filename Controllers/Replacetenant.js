const mysql = require('mysql2/promise');

async function replaceTenantInDB(oldTenant, newTenant, dbConfig) {
  const connection = await mysql.createConnection(dbConfig);

  // 1. Buscar todas as colunas varchar/text da base
  const [columns] = await connection.execute(`
    SELECT TABLE_NAME, COLUMN_NAME 
    FROM INFORMATION_SCHEMA.COLUMNS
    WHERE TABLE_SCHEMA = ?
      AND DATA_TYPE IN ('varchar', 'text', 'char')
  `, [dbConfig.database]);

  for (const { TABLE_NAME, COLUMN_NAME } of columns) {
    // 2. Verifica se o valor existe na coluna
    const [rows] = await connection.execute(
      `SELECT COUNT(*) as count FROM \`${TABLE_NAME}\` WHERE \`${COLUMN_NAME}\` = ?`, 
      [oldTenant]
    );

    if (rows[0].count > 0) {
      // 3. Faz o update substituindo oldTenant por newTenant na coluna
      const [result] = await connection.execute(
        `UPDATE \`${TABLE_NAME}\` SET \`${COLUMN_NAME}\` = ? WHERE \`${COLUMN_NAME}\` = ?`,
        [newTenant, oldTenant]
      );

      console.log(`Tabela ${TABLE_NAME}, coluna ${COLUMN_NAME} atualizada: ${result.affectedRows} linhas.`);
    }
  }

  await connection.end();
}

// Uso exemplo:
const dbConfig = {
  host: "ws5.angoweb.net",
  user: "eduallao_andre",
  password: "q!s&$AXo@{dc",
  database: "eduallao_institutes",
  port: 3306,
};

replaceTenantInDB('29sVaJwcQMpLYNUDfVJfz128kygWOOmExbqKWL18EDWdyDJYCD2Tp4yVGup4qyHwReG0BaILnYio1rini2oB9hQD28xcsZKsOUZ', 
  'edodemoacademiadadialeticadoconhecimento', dbConfig)
  .then(() => console.log('Substituição completa'))
  .catch(console.error);

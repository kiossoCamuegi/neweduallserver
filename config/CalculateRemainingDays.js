const moment = require("moment");

const CalculateRemainingDays = (startDate, endDate) => {
  const currentDate = new Date();
  const EndDate = new Date(moment(endDate).format("MM/DD/YYYY"));

  // Se a licença já expirou
  if (EndDate.getTime() < currentDate.getTime()) return 0;

  // Diferença entre a data de hoje e a data de fim
  const Difference_In_Time = EndDate.getTime() - currentDate.getTime();
  const LicenceLeftDays = Math.ceil(Difference_In_Time / (1000 * 3600 * 24));

  return LicenceLeftDays;
};

module.exports = CalculateRemainingDays;

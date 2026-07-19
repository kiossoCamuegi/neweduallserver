async function deleteKeysByPrefix(prefix) {
  // lógica aqui
}

function cacheMiddleware() {
  return (req, res, next) => {
    next();
  };
}

module.exports = { deleteKeysByPrefix, cacheMiddleware };

const STATUS_CODES = new Map([
  [400, 'BAD_REQUEST'],
  [401, 'UNAUTHORIZED'],
  [403, 'FORBIDDEN'],
  [404, 'NOT_FOUND'],
  [409, 'CONFLICT'],
  [422, 'UNPROCESSABLE_ENTITY'],
  [500, 'INTERNAL_SERVER_ERROR'],
  [502, 'BAD_GATEWAY'],
  [503, 'SERVICE_UNAVAILABLE'],
]);

function addErrorContract(request, response, next) {
  const sendJson = response.json.bind(response);
  response.json = (payload) => {
    if (!payload || typeof payload !== 'object' || payload.success !== false) {
      return sendJson(payload);
    }

    const message = typeof payload.message === 'string' ? payload.message : 'Request failed';
    return sendJson({
      ...payload,
      error: payload.error || message,
      code: payload.code || STATUS_CODES.get(response.statusCode) || 'API_ERROR',
    });
  };
  next();
}

module.exports = { addErrorContract };

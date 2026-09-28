function requireRole(...roles) {
  return (request, response, next) => {
    if (!request.auth) {
      return response.status(401).json({ success: false, message: 'Authentication required' });
    }

    if (!roles.includes(request.auth.role)) {
      return response.status(403).json({ success: false, message: 'You do not have permission for this action' });
    }

    return next();
  };
}

module.exports = { requireRole };
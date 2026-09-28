function logError(context, error) {
  if (process.env.NODE_ENV === 'production') {
    console.error(context, {
      name: error?.name || 'Error',
      ...(error?.code ? { code: error.code } : {}),
    });
    return;
  }

  console.error(context, error);
}

module.exports = { logError };
export async function getEdgeFunctionErrorMessage({ error, data } = {}) {
  if (data?.error) {
    return String(data.error);
  }

  if (error?.context && typeof error.context.json === 'function') {
    try {
      const body = await error.context.json();

      if (body?.error) {
        return String(body.error);
      }

      if (body?.message) {
        return String(body.message);
      }
    } catch (parseError) {
      console.warn('[SALO] Failed to parse edge function error body', parseError);
    }
  }

  if (error?.message) {
    return error.message;
  }

  return 'Unknown edge function error.';
}

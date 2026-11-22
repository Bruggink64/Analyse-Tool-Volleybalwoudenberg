const ACCESS_CODE_KEY = 'volleyscout_access_code';

function readAccessCode(): string {
  try {
    return window.localStorage.getItem(ACCESS_CODE_KEY) ?? '';
  } catch {
    return '';
  }
}

function storeAccessCode(code: string): void {
  try {
    if (code) window.localStorage.setItem(ACCESS_CODE_KEY, code);
    else window.localStorage.removeItem(ACCESS_CODE_KEY);
  } catch {
    // opslag geblokkeerd: code geldt dan alleen voor deze sessie
  }
}

let sessionCode = readAccessCode();

/**
 * POST naar de eigen API met (indien ingesteld) de toegangscode.
 * Bij een 401 vraagt hij één keer om de code en probeert het opnieuw.
 */
export async function postApi(
  path: string,
  body: unknown,
  signal?: AbortSignal
): Promise<Response> {
  const send = () =>
    fetch(path, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(sessionCode ? { 'X-Access-Code': sessionCode } : {}),
      },
      signal,
      body: JSON.stringify(body),
    });

  let response = await send();
  if (response.status === 401) {
    const entered = window.prompt(
      sessionCode
        ? 'De toegangscode klopt niet. Vul de juiste code in:'
        : 'Deze analyse-tool is beveiligd. Vul de toegangscode in:'
    );
    if (entered && entered.trim()) {
      sessionCode = entered.trim();
      storeAccessCode(sessionCode);
      response = await send();
    }
    if (response.status === 401) {
      sessionCode = '';
      storeAccessCode('');
    }
  }
  return response;
}

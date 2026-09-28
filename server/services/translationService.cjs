const DEFAULT_API_URL = 'https://generativelanguage.googleapis.com/v1beta/openai/chat/completions';
const DEFAULT_MODEL = 'gemini-3.8-flash';
const REQUEST_TIMEOUT_MS = 30000;
const { prepareMundariForms, translateWithUploadedModule } = require('./uploadedTranslationService.cjs');

class TranslationServiceError extends Error {
  constructor(message, code) {
    super(message);
    this.name = 'TranslationServiceError';
    this.code = code;
  }
}

function isRomanScript(text) {
  const letters = text.match(/\p{L}/gu) || [];
  return letters.length > 0
    && letters.every((letter) => /\p{Script=Latin}/u.test(letter))
    && !/\p{Script=Devanagari}/u.test(text);
}

async function translateHindiToMundari(hindiText, { outputScript = 'devanagari' } = {}) {
  const uploadedTranslation = await translateWithUploadedModule(hindiText);
  if (uploadedTranslation) {
    return uploadedTranslation;
  }

  const apiKey = process.env.AI_API_KEY;
  const apiUrl = process.env.AI_API_URL || DEFAULT_API_URL;
  const model = process.env.AI_MODEL || DEFAULT_MODEL;

  if (!apiKey) {
    throw new TranslationServiceError('AI translation provider is not configured', 'NOT_CONFIGURED');
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);

  try {
    const requestOptions = {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${apiKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model,
        temperature: 0,
        messages: [
          {
            role: 'system',
            content: outputScript === 'roman'
              ? 'Translate Hindi into Mundari. Output only the translation in Latin/Roman letters using Mundari Roman spelling. Never output Devanagari, Hindi, English explanations, or placeholders. Verified examples for spelling only: आम = Uli; केला = Kela; एक = Miyad; दो = Bariya; तीन = Apiya; चार = Upuna; पाँच = Moreya; आम गिनो = Uli leka me. These examples are not a translation of the input unless it matches. Preserve meaning and numbers. This output is an unverified draft. If unsure, return a best-effort Mundari Roman translation, not question marks.'
              : 'Translate from Hindi to Mundari. Write the Mundari translation in Devanagari script. Do not write a Hindi translation, and do not romanize the result. Preserve educational meaning and information. Prefer simple language for Grade 1 foundational literacy and numeracy classroom use. Preserve numbers and classroom instructions. Return only the Mundari translation text, without explanations or claims of validation.',
          },
          {
            role: 'user',
            content: hindiText,
          },
        ],
      }),
      signal: controller.signal,
    };
    let response;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      response = await fetch(apiUrl, requestOptions);
      if (response.ok || (response.status < 500 && response.status !== 429) || attempt === 1) break;
      await new Promise((resolve) => setTimeout(resolve, 350));
    }

    if (!response.ok) {
      throw new TranslationServiceError(`AI translation provider request failed with HTTP ${response.status}`, 'PROVIDER_ERROR');
    }

    const payload = await response.json();
    const mundariTranslation = payload?.choices?.[0]?.message?.content?.trim();

    if (!mundariTranslation) {
      throw new TranslationServiceError('AI translation provider returned an empty response', 'EMPTY_RESPONSE');
    }

    if (outputScript === 'roman') {
      if (!isRomanScript(mundariTranslation)) {
        throw new TranslationServiceError('AI translation provider did not return Mundari Roman text', 'INVALID_SCRIPT');
      }

      return {
        mundari_translation: mundariTranslation,
        mundari_roman: mundariTranslation,
        romanization_verified: false,
        romanization_source: null,
        tts_input: null,
        tts_input_script: null,
        modelVersion: model,
        translationVerified: false,
      };
    }

    const forms = await prepareMundariForms(mundariTranslation, model);
    if (!forms?.mundari_translation) {
      throw new TranslationServiceError('Mundari translation could not be prepared', 'PREPARATION_ERROR');
    }

    return {
      ...forms,
      modelVersion: model,
      translationVerified: false,
    };
  } catch (error) {
    if (error instanceof TranslationServiceError) {
      throw error;
    }

    if (error.name === 'AbortError') {
      throw new TranslationServiceError('AI translation provider timed out', 'TIMEOUT');
    }

    throw new TranslationServiceError('AI translation provider request failed', 'PROVIDER_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

module.exports = { TranslationServiceError, translateHindiToMundari };

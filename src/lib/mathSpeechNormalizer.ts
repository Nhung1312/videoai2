/**
 * MathSpeechNormalizer
 * Converts mathematical formulas and LaTeX expressions into natural Vietnamese speech text.
 */

export function normalizeMathToVietnameseSpeech(latexOrText: string): string {
  if (!latexOrText) return '';

  let speech = latexOrText.trim();

  // 0. Common Vietnamese algebra narration cleanup
  // Keep lowercase algebra variables distinct from uppercase geometry point names.
  speech = speech.replace(/\bPT\b/gi, 'phương trình');
  speech = speech.replace(/\bPB\b/gi, 'phân biệt');
  speech = speech.replace(/\bt\s*\/\s*m\b/gi, 'thỏa mãn');
  speech = speech.replace(/\b(?:đen[\s-]*ta|delta)\s*phẩy\b/gi, 'đen ta phẩy');
  speech = speech.replace(/\b(?:đen[\s-]*ta|delta)\b/gi, 'đen ta');
  speech = speech.replace(/x\s*[_₁]?1\b/gi, 'ích một');
  speech = speech.replace(/x\s*[_₂]?2\b/gi, 'ích hai');
  speech = speech.replace(/x₁/gi, 'ích một');
  speech = speech.replace(/x₂/gi, 'ích hai');
  speech = speech.replace(/m²/g, 'mờ bình phương');
  speech = speech.replace(/\bm\s*\^\s*2\b/gi, 'mờ bình phương');

  // 1. Common Vietnamese Geometry phrases & abbreviations
  speech = speech.replace(/\\Delta\s*([A-Z]{1,4})/g, 'tam giác $1');
  speech = speech.replace(/\\triangle\s*([A-Z]{1,4})/g, 'tam giác $1');
  speech = speech.replace(/[△▲]\s*([A-Z]{1,4})/g, 'tam giác $1');
  // Any remaining Delta is the discriminant, not triangle notation.
  speech = speech.replace(/(?:Δ|\\Delta)\s*['’′]/g, 'đen ta phẩy');
  speech = speech.replace(/(?:Δ|\\Delta)/g, 'đen ta');
  speech = speech.replace(/\\widehat\{([A-Z]{1,4})\}/g, 'góc $1');
  speech = speech.replace(/\\angle\s*([A-Z]{1,4})/g, 'góc $1');
  speech = speech.replace(/∠\s*([A-Z]{1,4})/g, 'góc $1');

  // Geometric relations (LaTeX and Unicode)
  speech = speech.replace(/(\\perp|[⊥⟂])/g, ' vuông góc với ');
  speech = speech.replace(/(\\parallel|[∥]|(?<=[A-Z0-9\s])\/\/(?=[A-Z0-9\s]))/g, ' song song với ');
  speech = speech.replace(/(\\sim|[∼])/g, ' đồng dạng với ');
  speech = speech.replace(/(\\cong|[≅≡])/g, ' bằng ');

  // Logic connectors
  speech = speech.replace(/\\iff/g, ' tương đương ');
  speech = speech.replace(/\\implies/g, ' suy ra ');
  speech = speech.replace(/\\Leftarrow/g, ' khi ');
  speech = speech.replace(/\\Leftrightarrow/g, ' tương đương ');
  speech = speech.replace(/\\Rightarrow/g, ' suy ra ');

  // Degree symbol
  speech = speech.replace(/(\d+)\s*\^\s*\\circ/g, '$1 độ');
  speech = speech.replace(/(\d+)\s*\^\{\\circ\}/g, '$1 độ');
  speech = speech.replace(/90\s*độ/g, 'chín mươi độ');
  speech = speech.replace(/180\s*độ/g, 'một trăm tám mươi độ');

  // Fractions: \frac{a}{b} -> "a phần b"
  // Handles nested or simple braces
  const fracRegex = /\\frac\{([^{}]+)\}\{([^{}]+)\}/g;
  while (fracRegex.test(speech)) {
    speech = speech.replace(fracRegex, '$1 phần $2');
  }

  // Square root: \sqrt{x} -> "căn bậc hai của x"
  const sqrtRegex = /\\sqrt\{([^{}]+)\}/g;
  while (sqrtRegex.test(speech)) {
    speech = speech.replace(sqrtRegex, 'căn bậc hai của $1');
  }

  // Powers & Exponents
  speech = speech.replace(/([a-zA-Z0-9\(\)]+)\^2/g, '$1 bình phương');
  speech = speech.replace(/([a-zA-Z0-9\(\)]+)\^3/g, '$1 lập phương');
  speech = speech.replace(/([a-zA-Z0-9\(\)]+)\^\{2\}/g, '$1 bình phương');
  speech = speech.replace(/([a-zA-Z0-9\(\)]+)\^\{3\}/g, '$1 lập phương');
  speech = speech.replace(/([a-zA-Z0-9\(\)]+)\^([a-zA-Z0-9]+)/g, '$1 mũ $2');
  speech = speech.replace(/([a-zA-Z0-9\(\)]+)\^\{([^}]+)\}/g, '$1 mũ $2');

  // Comparison & Operators
  speech = speech.replace(/\\ge/g, ' lớn hơn hoặc bằng ');
  speech = speech.replace(/\\le/g, ' nhỏ hơn hoặc bằng ');
  speech = speech.replace(/\\geq/g, ' lớn hơn hoặc bằng ');
  speech = speech.replace(/\\leq/g, ' nhỏ hơn hoặc bằng ');
  speech = speech.replace(/\\ne/g, ' khác ');
  speech = speech.replace(/\\neq/g, ' khác ');
  speech = speech.replace(/\\pm/g, ' cộng trừ ');
  speech = speech.replace(/\\times/g, ' nhân ');
  speech = speech.replace(/\\cdot/g, ' nhân ');

  // Symbols
  speech = speech.replace(/\\approx/g, ' xấp xỉ ');
  speech = speech.replace(/\\in/g, ' thuộc ');
  speech = speech.replace(/\\notin/g, ' không thuộc ');
  speech = speech.replace(/\\subset/g, ' con của ');
  speech = speech.replace(/\\cap/g, ' giao ');
  speech = speech.replace(/\\cup/g, ' hợp ');

  // Clean remaining LaTeX commands like \text{...} or \mathrm{...}
  speech = speech.replace(/\\text\{([^}]+)\}/g, '$1');
  speech = speech.replace(/\\mathrm\{([^}]+)\}/g, '$1');
  speech = speech.replace(/\\mathbf\{([^}]+)\}/g, '$1');
  speech = speech.replace(/\\left/g, '');
  speech = speech.replace(/\\right/g, '');
  speech = speech.replace(/\\begin\{[a-zA-Z]+\}/g, '');
  speech = speech.replace(/\\end\{[a-zA-Z]+\}/g, '');
  speech = speech.replace(/\\\\/g, ', ');
  speech = speech.replace(/[\r\n]+/g, ', ');

  // Basic math characters
  speech = speech.replace(/=/g, ' bằng ');
  speech = speech.replace(/\+/g, ' cộng ');
  speech = speech.replace(/(?<!\p{L})-(?=\s|\d|[a-zA-Z])/gu, ' trừ ');
  speech = speech.replace(/\*/g, ' nhân ');
  speech = speech.replace(/\//g, ' chia ');
  speech = speech.replace(/>/g, ' lớn hơn ');
  speech = speech.replace(/</g, ' nhỏ hơn ');

  // Isolated lowercase algebra variables/coefficients in Vietnamese math speech.
  speech = speech.replace(/(?<!\p{L})m(?!\p{L})/gu, 'mờ');
  speech = speech.replace(/(?<!\p{L})x(?!\p{L})/gu, 'ích');
  speech = speech.replace(/(?<!\p{L})y(?!\p{L})/gu, 'i');
  speech = speech.replace(/(?<!\p{L})b(?!\p{L})/gu, 'bê');
  speech = speech.replace(/(?<!\p{L})c(?!\p{L})/gu, 'xê');
  speech = speech.replace(/(?<!\p{L})d(?!\p{L})/gu, 'đê');
  speech = speech.replace(/(?<!\p{L})n(?!\p{L})/gu, 'en');
  speech = speech.replace(/(?<!\p{L})t(?!\p{L})/gu, 'tê');

  // Geometry point/segment names must be spoken as conventional Vietnamese
  // letter NAMES, not browser phonics ("hờ", "bờ", "cờ").
  // Example: AH -> "a hát", BC -> "bê xê", AHBK -> "a hát bê ca".
  const geometryLetterNames: Record<string, string> = {
    A: 'a', B: 'bê', C: 'xê', D: 'đê', E: 'e', F: 'ép', G: 'giê',
    H: 'hát', I: 'i', J: 'giây', K: 'ca', L: 'eo', M: 'em', N: 'en',
    O: 'o', P: 'pê', Q: 'quy', R: 'e rờ', S: 'ét', T: 'tê', U: 'u',
    V: 'vê', W: 'vê kép', X: 'ích', Y: 'i dài', Z: 'dét',
  };
  const speakGeometryLetters = (token: string) =>
    token.split('').map((letter) => geometryLetterNames[letter] || letter).join(' ');

  // Convert compact uppercase geometry tokens before final cleanup.
  speech = speech.replace(/\b[A-Z]{1,6}\b/g, (token) => speakGeometryLetters(token));

  // Strip excessive backslashes or curly braces
  speech = speech.replace(/[{}\\]/g, ' ');

  // Normalize multi-spaces
  speech = speech.replace(/\s+/g, ' ').trim();

  return speech;
}

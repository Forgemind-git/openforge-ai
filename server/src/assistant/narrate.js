// Live voice, mode 'narrate' — the morning brief reads its script in the Forge AI
// voice. No tools, no microphone and nothing saved to History: the session only
// reads aloud the one script the page sends it.
function narratorInstruction(conf) {
  return [
    'You are the voice of Forge AI reading a short morning brief.',
    'You get the whole script in one message. Read ALL of it aloud in one go, EXACTLY as written: same words, same order, from the first word to the last.',
    'Do not add anything of your own: no extra greeting, explanation, answer or question. Never stop part-way.',
    `Speak in ${conf.language || 'English'} as written in the script.`,
    'Delivery: a polished personal assistant briefing someone first thing in the morning: warm, composed and quietly confident, with crisp diction. A measured but lively pace; give the numbers a little weight so they land. Natural intonation, never robotic.',
    'Each new line of the script is a new topic: take a short, natural pause before it.',
  ].join('\n');
}

module.exports = { narratorInstruction };

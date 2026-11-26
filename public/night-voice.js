import { roles } from './boards.js';

export function createNightVoice({ synthesis, Utterance, onError }) {
  let current;

  function stop() {
    if (!current) return false;
    const interruptedCall = Boolean(current.text);
    current = undefined;
    synthesis.cancel();
    return interruptedCall;
  }

  function speak(text) {
    if (!synthesis || typeof Utterance !== 'function') {
      onError('synthesis-unavailable');
      return false;
    }
    stop();
    try {
      const utterance = new Utterance(text);
      utterance.lang = 'zh-CN';
      utterance.onend = () => {
        if (current === utterance) current = undefined;
      };
      utterance.onerror = ({ error }) => {
        if (current !== utterance) return;
        current = undefined;
        if (text) onError(error);
      };
      current = utterance;
      synthesis.speak(utterance);
      return true;
    } catch {
      current = undefined;
      onError('synthesis-failed');
      return false;
    }
  }

  return {
    // iOS unlocks future speech when speak() is called directly from a tap.
    prime: () => speak(''),
    speakRole(roleId) {
      if (typeof roleId !== 'string' || !Object.hasOwn(roles, roleId)) return false;
      return speak(`${roles[roleId].name}请睁眼`);
    },
    isSpeaking: () => Boolean(current?.text),
    stop,
  };
}

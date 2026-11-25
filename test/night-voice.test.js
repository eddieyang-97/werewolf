import assert from 'node:assert/strict';
import test from 'node:test';
import { createNightVoice } from '../public/night-voice.js';

class Utterance {
  constructor(text) { this.text = text; }
}

function setup() {
  const spoken = [];
  const errors = [];
  const synthesis = {
    speak(utterance) { spoken.push(utterance); },
    cancel() { spoken.at(-1).onerror({ error: 'interrupted' }); },
  };
  const voice = createNightVoice({ synthesis, Utterance, onError: error => errors.push(error) });
  return { voice, spoken, errors, synthesis };
}

test('a tap primes silently and only known role names are spoken in Mandarin', () => {
  const { voice, spoken, errors } = setup();
  assert.equal(voice.prime(), true);
  assert.equal(spoken[0].text, '');
  for (const role of ['constructor', '无效请睁眼', null]) assert.equal(voice.speakRole(role), false);
  assert.equal(voice.speakRole('wolfBeauty'), true);
  assert.deepEqual(spoken.map(({ text, lang }) => [text, lang]), [
    ['', 'zh-CN'], ['狼美人请睁眼', 'zh-CN'],
  ]);
  assert.deepEqual(errors, []);
});

test('stopping or replacing a cue ignores stale synthesis callbacks', () => {
  const { voice, spoken, errors } = setup();
  voice.speakRole('guard');
  voice.speakRole('wolf');
  spoken[0].onend();
  spoken[0].onerror({ error: 'audio-hardware' });
  spoken[1].onerror({ error: 'language-unavailable' });
  assert.deepEqual(errors, ['language-unavailable']);

  voice.speakRole('witch');
  assert.equal(voice.stop(), true);
  assert.equal(voice.stop(), false);
  spoken[2].onerror({ error: 'audio-busy' });
  assert.deepEqual(errors, ['language-unavailable']);
});

test('unavailable or failing speech synthesis reports an error without throwing', () => {
  const { synthesis, voice, errors } = setup();
  const unsupported = createNightVoice({ onError: error => errors.push(error) });
  assert.equal(unsupported.prime(), false);
  synthesis.speak = () => { throw new Error('playback failed'); };
  assert.equal(voice.speakRole('seer'), false);
  assert.deepEqual(errors, ['synthesis-unavailable', 'synthesis-failed']);
});

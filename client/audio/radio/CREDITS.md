# The car radio's voice

`car-radio-am_michael.mp3` and `car-radio-af_bella.mp3` are the car radio's call for the airfield (issue #269), spoken
by AI voices: Kokoro (kokoro-onnx, the int8 model `kokoro-v1.0`, Apache-2.0 weights), voices `am_michael` and
`af_bella`, generated locally on 2026-10-11. The static intro, the radio's band-pass and the static under the voice
were added with ffmpeg. `client/audio/samples.js` loads them as `vo_radio_am_michael` / `vo_radio_af_bella`, and
`Game.carRadio` plays one of the two at random.

"""生成默认 BGM 音频文件"""
import os, wave, math, struct, random

BGM_DIR = os.path.join(os.path.dirname(__file__), '..', 'static', 'bgm')
os.makedirs(BGM_DIR, exist_ok=True)

SAMPLE_RATE = 44100
DURATION = 30  # 30 seconds, will loop

def write_wav(path, frames):
    with wave.open(path, 'w') as wf:
        wf.setnchannels(1)
        wf.setsampwidth(2)
        wf.setframerate(SAMPLE_RATE)
        wf.writeframes(frames)
    size_mb = os.path.getsize(path) / 1024 / 1024
    print(f"  {os.path.basename(path)}: {size_mb:.1f}MB")

def sine_wave(freq, t, amp=0.3):
    return amp * math.sin(2 * math.pi * freq * t)

def envelope(t, dur):
    attack = min(1.0, t / 0.5)
    release = min(1.0, (dur - t) / 0.5)
    return min(attack, release)

# BGM 1: 宁静竹林 - 柔和高频泛音
def gen_bamboo_forest():
    frames = bytearray()
    for i in range(SAMPLE_RATE * DURATION):
        t = i / SAMPLE_RATE
        env = envelope(t, DURATION)
        sample = 0
        sample += sine_wave(220.0, t, 0.15)   # A3
        sample += sine_wave(329.6, t, 0.10)   # E4
        sample += sine_wave(440.0, t, 0.08)   # A4
        sample += sine_wave(587.3, t, 0.05)   # D5
        # 风声颤音
        vibrato = 0.03 * math.sin(2 * math.pi * 0.3 * t)
        sample += sine_wave(880.0 + vibrato * 200, t, 0.03)
        sample *= env * 0.5
        sample = max(-1.0, min(1.0, sample))
        frames.extend(struct.pack('<h', int(sample * 32767)))
    write_wav(os.path.join(BGM_DIR, 'bamboo_forest.wav'), bytes(frames))

# BGM 2: 月夜湖畔 - 温暖低沉
def gen_moon_lake():
    frames = bytearray()
    for i in range(SAMPLE_RATE * DURATION):
        t = i / SAMPLE_RATE
        env = envelope(t, DURATION)
        sample = 0
        sample += sine_wave(130.8, t, 0.20)   # C3
        sample += sine_wave(196.0, t, 0.15)   # G3
        sample += sine_wave(261.6, t, 0.10)   # C4
        sample += sine_wave(349.2, t, 0.06)   # F4
        # 水波颤音
        tremolo = 0.08 * math.sin(2 * math.pi * 0.5 * t)
        sample += sine_wave(523.3, t, 0.04 + tremolo)  # C5
        sample *= env * 0.45
        sample = max(-1.0, min(1.0, sample))
        frames.extend(struct.pack('<h', int(sample * 32767)))
    write_wav(os.path.join(BGM_DIR, 'moon_lake.wav'), bytes(frames))

# BGM 3: 晨光花园 - 明亮欢快
def gen_garden_morning():
    frames = bytearray()
    for i in range(SAMPLE_RATE * DURATION):
        t = i / SAMPLE_RATE
        env = envelope(t, DURATION)
        sample = 0
        sample += sine_wave(392.0, t, 0.12)   # G4
        sample += sine_wave(523.3, t, 0.10)   # C5
        sample += sine_wave(659.3, t, 0.08)   # E5
        sample += sine_wave(784.0, t, 0.06)   # G5
        # 鸟鸣效果
        chirp = 0.02 * math.sin(2 * math.pi * (1000 + 500 * math.sin(2 * math.pi * 2 * t)) * t)
        sample += chirp
        sample *= env * 0.4
        sample = max(-1.0, min(1.0, sample))
        frames.extend(struct.pack('<h', int(sample * 32767)))
    write_wav(os.path.join(BGM_DIR, 'garden_morning.wav'), bytes(frames))

# BGM 4: 星空漫步 - 空灵
def gen_starry_walk():
    frames = bytearray()
    for i in range(SAMPLE_RATE * DURATION):
        t = i / SAMPLE_RATE
        env = envelope(t, DURATION)
        sample = 0
        sample += sine_wave(110.0, t, 0.18)   # A2
        sample += sine_wave(220.0, t, 0.12)   # A3
        sample += sine_wave(330.0, t, 0.10)   # E4 (slightly off)
        sample += sine_wave(440.0, t, 0.06)   # A4
        # 闪烁星
        twinkle = 0.04 * math.sin(2 * math.pi * 1760 * t) * (0.5 + 0.5 * math.sin(2 * math.pi * 0.7 * t))
        sample += twinkle
        sample *= env * 0.4
        sample = max(-1.0, min(1.0, sample))
        frames.extend(struct.pack('<h', int(sample * 32767)))
    write_wav(os.path.join(BGM_DIR, 'starry_walk.wav'), bytes(frames))

# BGM 5: 书卷气息 - 古典沉稳
def gen_bookish():
    frames = bytearray()
    for i in range(SAMPLE_RATE * DURATION):
        t = i / SAMPLE_RATE
        env = envelope(t, DURATION)
        sample = 0
        sample += sine_wave(146.8, t, 0.18)   # D3
        sample += sine_wave(220.0, t, 0.14)   # A3
        sample += sine_wave(293.7, t, 0.10)   # D4
        sample += sine_wave(369.9, t, 0.06)   # F#4
        sample += sine_wave(440.0, t, 0.04)   # A4
        sample *= env * 0.4
        sample = max(-1.0, min(1.0, sample))
        frames.extend(struct.pack('<h', int(sample * 32767)))
    write_wav(os.path.join(BGM_DIR, 'bookish.wav'), bytes(frames))

if __name__ == '__main__':
    print("生成默认 BGM 音频...")
    gen_bamboo_forest()
    gen_moon_lake()
    gen_garden_morning()
    gen_starry_walk()
    gen_bookish()
    print("完成！生成的文件：")
    for f in sorted(os.listdir(BGM_DIR)):
        if f.endswith('.wav'):
            print(f"  {f}")

# Sidewalk

You are late. Your gate is at the far end of the airport. Everyone between you and it is walking slowly, staring at a phone, herding a toddler, or driving a beeping cart.

Take the straightest path you can, dodge everything, and board.

Sidewalk is a gate-dash airport game. Plain HTML5 canvas. No dependencies, no build step. Works on desktop and phones.

## Run it locally

Open `index.html` in a browser. That is it.

Or serve the folder if you prefer:

```bash
python3 -m http.server 8000
# then open http://localhost:8000
```

Add `?unlock` to the URL to unlock all levels.

## Controls

| | Desktop | Touch |
|---|---|---|
| Move | WASD or arrow keys | Drag anywhere (floating joystick) |
| Hustle | Hold Shift or X | Hold the red HUSTLE button |
| Pause | P or Esc | Pause button |

Hustle is faster but drains stamina, and a crash while hustling stuns you longer.

## Scoring

- **Efficiency** = shortest possible path / the path you actually walked. Worth up to 2000 points, cubed, so detours hurt.
- **Time left** = 40 points per spare second.
- **Close calls** = 25 points each for threading past someone without touching them.
- **Collisions** = -150 each, plus a stun.
- **Level bonus** = 500 x level number.
- Moving walkways carry you for free, so they raise your efficiency.

Stars: 3 = 85%+ efficiency and at most 1 crash, 2 = 65%+ and at most 4, 1 = you boarded.

## Levels

1. Curb to Check-In - warm-up
2. Security Theater - serpentine ropes, spills, groups
3. The Long Concourse - moving walkway, runaway luggage, beeping carts
4. Duty-Free Maze - kiosks, perfume clouds, running kids
5. Gate Change - the gate moves behind you mid-level
6. Last Call - everything at once

Hazards: slow walkers, phone zombies (random stops and drifts), tour groups, loose luggage, cart traffic, spills, perfume sprayers, and boarding announcements.

Best scores are saved in your browser (localStorage).

## Files

- `index.html` - page and overlays
- `style.css` - layout and menus
- `game.js` - everything else (levels, entities, scoring, rendering, input)

## Deployment

Not deployed. It is a static site, so GitHub Pages or any static host works when you want it.

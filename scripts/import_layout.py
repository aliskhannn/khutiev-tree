"""Recover the original Coggle geometry from the pdftocairo SVG used for people.json.

Usage: python3 scripts/import_layout.py /path/to/coggle.svg
Input SVG: pdftocairo -svg downloaded.pdf coggle.svg (Poppler 26.01.0).
Output coordinates are PDF points. Each edge is [x, y, c1x, c1y, c2x, c2y, x, y, ...].
"""

import argparse
import json
import math
import re
import xml.etree.ElementTree as ET
from pathlib import Path


DATA = Path(__file__).resolve().parents[1] / 'data'
SVG_PATH = '{http://www.w3.org/2000/svg}path'
NUMBER = re.compile(r'[-+]?(?:\d*\.\d+|\d+)(?:[eE][-+]?\d+)?')
CARD = 'MCCCCLCCCCLCCCCLCCCCZM'
ROOT_CARD = 'MLLLCCCCLLLLCCCCLLLLCCCCLLLLCCCCZM'
SHORT_LINK = 'MLLLLLZM'


def coordinates(s):
    return [float(value) for value in NUMBER.findall(s)]


def port(point, direction, nodes):
    """A link ends on the centerline of one of a card's four sides."""
    dx, dy = direction
    magnitude = math.hypot(dx, dy)
    dx, dy = dx / magnitude, dy / magnitude
    matches = []
    for index, (cx, cy, width, height) in nodes.items():
        if abs(dx) > abs(dy):
            x, y = cx - math.copysign(width / 2, dx), cy
        else:
            x, y = cx, cy - math.copysign(height / 2, dy)
        x, y = x - point[0], y - point[1]
        along = dx * x + dy * y
        across = abs(dx * y - dy * x)
        if -2 <= along <= 17 and across < 0.5:
            matches.append(index)
    if len(matches) != 1:
        raise ValueError(f'Ambiguous port near {point}: {matches}')
    return matches[0]


def resolved_link(path, nodes):
    values = coordinates(path.attrib['d'])
    transform = path.get('transform')
    if transform:
        a, b, c, d, tx, ty = coordinates(transform)
        origins = [idx for idx, rect in nodes.items() if math.dist((tx, ty), rect[:2]) < 1.1]
        if len(origins) != 1:
            raise ValueError(f'Unmatched source {tx}, {ty}')
        source, = origins
        points = [(a*x + c*y + tx, b*x + d*y + ty) for x, y in zip(values[::2], values[1::2])]
        ex, ey = points[-1]
        control = next(p for p in reversed(points[:-1]) if math.dist(p, (ex, ey)) > 0.01)
        direction = (ex - control[0], ey - control[1])
    else:
        # Very short links in this PDF are filled straight arrow polygons.
        x, y = values[2:4]
        ex, ey = values[8:10]
        dx, dy = ex - x, ey - y
        source = port((x, y), (-dx, -dy), nodes)
        direction = dx, dy
        points = [(x, y), (x + dx/3, y + dy/3), (x + 2*dx/3, y + 2*dy/3), (ex, ey)]
    target = port(points[-1], direction, nodes)
    return source, target, [value for point in points for value in point]


def extract(svg, people):
    cards, links = {}, []
    for index, element in enumerate(ET.parse(svg).getroot()):
        if element.tag != SVG_PATH:
            continue
        commands = re.sub(r'[^A-Z]', '', element.attrib['d'])
        if commands in (CARD, ROOT_CARD):
            points = coordinates(element.attrib['d'])
            x, y = points[::2], points[1::2]
            cards[index] = ((min(x)+max(x))/2, (min(y)+max(y))/2, max(x)-min(x), max(y)-min(y))
        elif 'stroke' in element.attrib or commands == SHORT_LINK:
            links.append(element)

    # The p-prefixed original IDs are SVG element indices. The named root is the
    # distinctive large card connected to the first generation.
    parents = {p['id']: p['parent'] for p in people}
    index_to_id = {int(i[1:]): i for i in parents if i != 'khuti'}
    relations = [resolved_link(path, cards) for path in links]
    root_children = {index for index, pid in index_to_id.items() if parents[pid] == 'khuti'}
    root_indices = {src for src, child, _ in relations if child in root_children}
    if len(root_indices) != 1:
        raise ValueError('Root mismatch between the SVG and the current family records')
    root, = root_indices
    index_to_id[root] = 'khuti'
    nodes = {pid: [round(v, 2) for v in cards[index]] for index, pid in index_to_id.items()}
    edges = {}
    for src, dst, curve in relations:
        if dst not in index_to_id and src not in index_to_id:
            continue  # Diagram legend and source article are separate components.
        child = index_to_id[dst]
        if child in edges or parents[child] != index_to_id[src] or (len(curve)-2) % 6:
            raise ValueError(f'Unexpected link for {child}')
        edges[child] = [round(value, 2) for value in curve]
    if nodes.keys() != parents.keys() or edges.keys() != parents.keys() - {'khuti'}:
        raise ValueError('Diagram geometry and people are not in one-to-one correspondence')
    rectangles = list(nodes.values())
    bounds = [min(cx-w/2 for cx, _, w, _ in rectangles), min(cy-h/2 for _, cy, _, h in rectangles),
              max(cx+w/2 for cx, _, w, _ in rectangles), max(cy+h/2 for _, cy, _, h in rectangles)]
    return {'nodes': nodes, 'edges': edges, 'bounds': [round(v, 2) for v in bounds]}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('svg', type=Path)
    args = parser.parse_args()
    layout = extract(args.svg, json.loads((DATA / 'people.json').read_text()))
    (DATA / 'layout.json').write_text(json.dumps(layout, separators=(',', ':')) + '\n')


if __name__ == '__main__':
    main()

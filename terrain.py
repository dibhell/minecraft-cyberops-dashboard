import gzip
import math
import struct
import zlib
from functools import lru_cache
from pathlib import Path


class NbtReader:
    def __init__(self, data):
        self.data = data
        self.pos = 0

    def take(self, size):
        end = self.pos + size
        if end > len(self.data):
            raise ValueError("truncated NBT")
        value = self.data[self.pos:end]
        self.pos = end
        return value

    def number(self, fmt):
        return struct.unpack(">" + fmt, self.take(struct.calcsize(">" + fmt)))[0]

    def string(self):
        return self.take(self.number("H")).decode("utf-8", errors="replace")

    def skip(self, tag):
        sizes = {1: 1, 2: 2, 3: 4, 4: 8, 5: 4, 6: 8}
        if tag in sizes:
            self.take(sizes[tag])
        elif tag == 7:
            self.take(self.number("i"))
        elif tag == 8:
            self.string()
        elif tag == 9:
            item_tag, length = self.number("B"), self.number("i")
            for _ in range(length):
                self.skip(item_tag)
        elif tag == 10:
            while True:
                child_tag = self.number("B")
                if child_tag == 0:
                    break
                self.string()
                self.skip(child_tag)
        elif tag in (11, 12):
            self.take(self.number("i") * (4 if tag == 11 else 8))
        else:
            raise ValueError(f"unknown NBT tag {tag}")

    def long_array(self):
        return [self.number("q") for _ in range(self.number("i"))]


def read_heightmaps(data):
    reader = NbtReader(data)
    if reader.number("B") != 10:
        raise ValueError("NBT root is not a compound")
    reader.string()
    min_y = -64
    maps = {}
    while True:
        tag = reader.number("B")
        if tag == 0:
            break
        name = reader.string()
        if name == "yPos" and tag in (1, 2, 3, 4):
            min_y = reader.number({1: "b", 2: "h", 3: "i", 4: "q"}[tag]) * 16
        elif name == "Heightmaps" and tag == 10:
            while True:
                map_tag = reader.number("B")
                if map_tag == 0:
                    break
                map_name = reader.string()
                if map_tag == 12:
                    maps[map_name] = reader.long_array()
                else:
                    reader.skip(map_tag)
        else:
            reader.skip(tag)
    return min_y, maps


def unpack_height(values, index, min_y):
    if not values:
        return None
    bits = next((bits for bits in range(1, 17) if math.ceil(256 / (64 // bits)) == len(values)), None)
    if not bits:
        return None
    per_long = 64 // bits
    value = (values[index // per_long] & ((1 << 64) - 1)) >> ((index % per_long) * bits)
    return (value & ((1 << bits) - 1)) + min_y


@lru_cache(maxsize=4096)
def read_chunk(region_path, chunk_x, chunk_z, modified_ns):
    del modified_ns
    slot = (chunk_x & 31) + (chunk_z & 31) * 32
    with open(region_path, "rb") as region:
        region.seek(slot * 4)
        location = region.read(4)
        if len(location) != 4:
            return None
        sector = int.from_bytes(location[:3], "big")
        if sector == 0:
            return None
        region.seek(sector * 4096)
        length_raw = region.read(4)
        if len(length_raw) != 4:
            return None
        length = int.from_bytes(length_raw, "big")
        compression = region.read(1)
        payload = region.read(length - 1)
    if not compression or compression[0] & 0x80:
        return None
    if compression[0] == 1:
        payload = gzip.decompress(payload)
    elif compression[0] == 2:
        payload = zlib.decompress(payload)
    elif compression[0] != 3:
        return None
    return read_heightmaps(payload)


def dimension_region(world_dir, dimension):
    if dimension == "minecraft:overworld":
        return world_dir / "region"
    if dimension == "minecraft:the_nether":
        return world_dir / "DIM-1" / "region"
    if dimension == "minecraft:the_end":
        return world_dir / "DIM1" / "region"
    namespace, path = dimension.split(":", 1)
    return world_dir / "dimensions" / namespace / path / "region"


def terrain_grid(world_dir, dimension, center_x, center_z, span=512, size=64):
    region_dir = dimension_region(Path(world_dir), dimension)
    start_x, start_z = center_x - span / 2, center_z - span / 2
    chunks = {}
    heights, kinds = [], []
    for row in range(size):
        z = math.floor(start_z + (row + 0.5) * span / size)
        for column in range(size):
            x = math.floor(start_x + (column + 0.5) * span / size)
            chunk_x, chunk_z = x // 16, z // 16
            key = (chunk_x, chunk_z)
            if key not in chunks:
                path = region_dir / f"r.{chunk_x // 32}.{chunk_z // 32}.mca"
                try:
                    chunks[key] = read_chunk(str(path), chunk_x, chunk_z, path.stat().st_mtime_ns)
                except (OSError, ValueError, EOFError, zlib.error, gzip.BadGzipFile):
                    chunks[key] = None
            chunk = chunks[key]
            if not chunk:
                heights.append(None)
                kinds.append("?")
                continue
            min_y, maps = chunk
            index = (z & 15) * 16 + (x & 15)
            surface = unpack_height(maps.get("WORLD_SURFACE"), index, min_y)
            ocean = unpack_height(maps.get("OCEAN_FLOOR"), index, min_y)
            no_leaves = unpack_height(maps.get("MOTION_BLOCKING_NO_LEAVES"), index, min_y)
            heights.append(surface)
            if surface is None:
                kinds.append("?")
            elif ocean is not None and surface > ocean + 1:
                kinds.append("w")
            elif no_leaves is not None and surface > no_leaves + 1:
                kinds.append("f")
            else:
                kinds.append("l")
    return {"center_x": center_x, "center_z": center_z, "span": span, "size": size, "heights": heights, "kinds": "".join(kinds)}

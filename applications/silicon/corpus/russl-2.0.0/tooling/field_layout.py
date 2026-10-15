"""Exact fixed-shape indexing experiments, not a field runtime or physical model."""
from fractions import Fraction

SHAPE = (4, 4, 4, 16, 16)
AXES = ('c4', 'c5', 'c6', 'c7', 'c8')
STRIDES = (4096, 1024, 256, 16, 1)
BITS = (2, 2, 2, 4, 4)
SITES = 16384

def ordinal(indices):
    if not isinstance(indices, (list, tuple)) or len(indices) != 5:
        raise ValueError('five indices required')
    if any(type(i) is not int or not 0 <= i < n for i, n in zip(indices, SHAPE)):
        raise ValueError('index outside fixed integer domain')
    return sum(i * stride for i, stride in zip(indices, STRIDES))

def indices(ordinal_value):
    if type(ordinal_value) is not int or not 0 <= ordinal_value < SITES:
        raise ValueError('ordinal outside fixed integer domain')
    return tuple((ordinal_value // stride) % n for stride, n in zip(STRIDES, SHAPE))

def coordinate(index, size):
    if type(index) is not int or type(size) is not int or size < 1 or not 0 <= index < size:
        raise ValueError('coordinate domain')
    return Fraction(0) if size == 1 else Fraction(2 * index - (size - 1), size - 1)

def p2_distance(a, b):
    """2-adic distance of integer ordinals; does not preserve Euclidean locality."""
    indices(a); indices(b)
    difference = abs(a - b)
    if difference == 0: return Fraction(0)
    valuation = (difference & -difference).bit_length() - 1
    return Fraction(1, 1 << valuation)

local ADDON, CRT = ...

-- The share engine: a table as one line of text to paste into another CRT, and back. Codes are pasted by
-- hand; nothing here sends an addon message.
--   Share.Encode(kind, version, data)   "!CRT:<kind>:<version>:<payload>", the payload the game's own CBOR,
--                                       Zlib (its checksum makes a cut-off or changed code fail) and base64
--   Share.Decode(text, kind, maxVersion, caps)
--                                       the data back, or nil and a reason to show: "Not a CRT <kind> code.",
--                                       "Made by a newer CRT. ..." or "Damaged code. ..."
-- Decoding never runs code: the game's CBOR reader only makes plain values, and Share.IsPlain then checks
-- every one of them (text, finite numbers, true or false, tables of those) against depth, size and count
-- caps, so a hand-made code can't hand over a function or an endless table. Pasted text may carry # header
-- lines, spaces and line breaks; Share.Clean drops them. A code longer than Share.MAX_TEXT isn't read.
-- The lower parts (Pack, Unpack, IsPlain, Clean) are also what CRT_Core/Profiles.lua's CRTP1: and CRTS1:
-- profile texts are made with, so both formats read as they always did.
-- Kinds so far: "alerts" (Alerts/Share.lua).
-- C_EncodingUtil (warcraft.wiki.gg): SerializeCBOR, DeserializeCBOR, CompressString(text, method),
-- DecompressString(text, method) (errors on a bad checksum), EncodeBase64, DecodeBase64.

local Share = {}
CRT.Share = Share

Share.PREFIX = "!CRT:"
Share.MAX_TEXT = 200000 -- characters of pasted text, header lines and spaces included
-- What a decoded code may hold, unless the caller gives caps of its own: tables at most this deep, this
-- many entries in one table and in all, and text this long (a key or a value).
Share.CAPS = { depth = 8, entries = 500, total = 20000, string = 2000 }

-- Zlib, not the default raw Deflate: its checksum makes a cut-off or changed string fail to decompress.
local ZLIB = (Enum and Enum.CompressionMethod and Enum.CompressionMethod.Zlib) or 1
Share.ZLIB = ZLIB

local TEXT = {
    noApi = "This game client can't read or write CRT codes.",
    notOurs = "Not a CRT %s code.",
    newer = "Made by a newer CRT. Update the addon first.",
    damaged = "Damaged code. Copy it again.",
    tooLong = "That code is too long to read.",
}
Share.TEXT = TEXT

-- The game's encoder, or nil when this client lacks a part of it.
function Share.Encoder()
    local E = C_EncodingUtil
    if E and E.SerializeCBOR and E.DeserializeCBOR and E.CompressString and E.DecompressString and E.EncodeBase64 and E.DecodeBase64 then
        return E
    end
    return nil
end

-- A value as base64 text: CBOR, compressed by method (nil: the game's default), base64. Nil when it fails.
function Share.Pack(value, method)
    local E = Share.Encoder()
    if not E then
        return nil
    end
    local ok, text = pcall(function()
        local cbor = E.SerializeCBOR(value)
        local packed
        if method == nil then
            packed = E.CompressString(cbor)
        else
            packed = E.CompressString(cbor, method)
        end
        return E.EncodeBase64(packed)
    end)
    if ok and type(text) == "string" then
        return text
    end
    return nil
end

-- The reverse of Pack. Nil when the text doesn't read (a bad checksum, cut off, not base64).
function Share.Unpack(block, method)
    local E = Share.Encoder()
    if not (E and type(block) == "string") then
        return nil
    end
    local ok, value = pcall(function()
        local packed = E.DecodeBase64(block)
        local cbor
        if method == nil then
            cbor = E.DecompressString(packed)
        else
            cbor = E.DecompressString(packed, method)
        end
        return E.DeserializeCBOR(cbor)
    end)
    if ok then
        return value
    end
    return nil
end

-- Pasted text without its # header lines and without the spaces and line breaks a paste can add.
function Share.Clean(text)
    local out = {}
    for line in tostring(text or ""):gmatch("[^\r\n]+") do
        if not line:find("^%s*#") then
            out[#out + 1] = line
        end
    end
    return (table.concat(out):gsub("%s", ""))
end

local function finite(v)
    return v == v and v ~= math.huge and v ~= -math.huge
end

-- Only plain data: true or false, a finite number, text at most caps.string long, or a table of those keyed
-- by such text or numbers, with tables at most caps.depth deep (depth: the level v is at, 1 by default) and at
-- most caps.entries entries each. caps.total (optional) caps the entries of every table together; counter
-- (optional, { n = 0 }) carries that count across calls.
function Share.IsPlain(v, caps, depth, counter)
    caps = caps or Share.CAPS
    depth = depth or 1
    local t = type(v)
    if t == "boolean" then
        return true
    elseif t == "number" then
        return finite(v)
    elseif t == "string" then
        return #v <= (caps.string or Share.CAPS.string)
    elseif t ~= "table" then
        return false
    end
    if depth > (caps.depth or Share.CAPS.depth) then
        return false
    end
    counter = counter or { n = 0 }
    local n = 0
    for k, x in pairs(v) do
        n = n + 1
        counter.n = counter.n + 1
        if n > (caps.entries or Share.CAPS.entries) or (caps.total and counter.n > caps.total) then
            return false
        end
        local kt = type(k)
        local keyOk = (kt == "string" and #k <= (caps.string or Share.CAPS.string)) or (kt == "number" and finite(k))
        if not keyOk or not Share.IsPlain(x, caps, depth + 1, counter) then
            return false
        end
    end
    return true
end

local function validKind(kind)
    return type(kind) == "string" and kind:find("^%a%w*$") ~= nil
end

-- A table as a code of its kind and version. Returns the code, or nil and the reason.
function Share.Encode(kind, version, data)
    if not validKind(kind) or type(version) ~= "number" or version < 1 or version % 1 ~= 0 or type(data) ~= "table" then
        return nil, TEXT.damaged
    end
    if not Share.Encoder() then
        return nil, TEXT.noApi
    end
    local block = Share.Pack(data, ZLIB)
    if not block then
        return nil, TEXT.damaged
    end
    return Share.PREFIX .. kind .. ":" .. version .. ":" .. block
end

-- The kind and version a pasted code says it is, or nil when it isn't a CRT code. Reads nothing else.
function Share.Peek(text)
    if type(text) ~= "string" or #text > Share.MAX_TEXT then
        return nil
    end
    local kind, version = Share.Clean(text):match("^!CRT:(%a%w*):(%d+):")
    if not kind then
        return nil
    end
    return kind, tonumber(version)
end

-- A pasted code back as its table, after every check: its kind, its version (at most maxVersion), its
-- checksum, and plain data within caps (default Share.CAPS). Returns the table and the code's version, or
-- nil and the reason to show.
function Share.Decode(text, kind, maxVersion, caps)
    local notOurs = TEXT.notOurs:format(tostring(kind))
    if type(text) ~= "string" then
        return nil, notOurs
    end
    if #text > Share.MAX_TEXT then
        return nil, TEXT.tooLong
    end
    local clean = Share.Clean(text)
    local got, version, block = clean:match("^!CRT:(%a%w*):(%d+):(.*)$")
    if not got or got ~= kind then
        return nil, notOurs
    end
    version = tonumber(version)
    if not version or version < 1 then
        return nil, TEXT.damaged
    end
    if version > (maxVersion or 1) then
        return nil, TEXT.newer
    end
    if not Share.Encoder() then
        return nil, TEXT.noApi
    end
    local data = Share.Unpack(block, ZLIB)
    if type(data) ~= "table" or not Share.IsPlain(data, caps or Share.CAPS) then
        return nil, TEXT.damaged
    end
    return data, version
end

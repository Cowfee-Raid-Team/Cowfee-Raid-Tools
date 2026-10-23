local ADDON, CRT = ...

-- A line diff of two note texts, for the note History window's Compare (Notes/HistoryWindow.lua).
--   NoteDiff.Lines(old, new) returns the lines in order, each { op = "same" | "remove" | "add", text },
--   and how many were added and removed. Line ends (LF or CRLF) are not part of a line; a text ending in
--   a line end has no empty last line.
-- The lines both texts start and end with are kept as they are; the middle is matched by its longest
-- common run of lines (LCS). A middle too large to match in one go (MAX_CELLS) shows as removed then added.

local Diff = {}
CRT.NoteDiff = Diff

local MAX_CELLS = 250000 -- the matching table's size cap (500 x 500 lines)

local function split(text)
    local out = {}
    text = text or ""
    if text == "" then
        return out
    end
    for line in (text .. "\n"):gmatch("(.-)\n") do
        out[#out + 1] = (line:gsub("\r$", ""))
    end
    if out[#out] == "" and text:sub(-1) == "\n" then
        out[#out] = nil
    end
    return out
end
Diff.Split = split

-- The middle of the two texts, a[lo..ahi] against b[lo..bhi], matched by LCS into out.
local function middle(a, b, lo, ahi, bhi, out)
    local n, m = ahi - lo + 1, bhi - lo + 1
    if n <= 0 or m <= 0 or n * m > MAX_CELLS then
        for i = lo, ahi do
            out[#out + 1] = { op = "remove", text = a[i] }
        end
        for j = lo, bhi do
            out[#out + 1] = { op = "add", text = b[j] }
        end
        return
    end
    -- len[i][j]: the longest common run of a[lo+i-1..ahi] and b[lo+j-1..bhi]
    local len = {}
    for i = n + 1, 1, -1 do
        len[i] = {}
        for j = m + 1, 1, -1 do
            if i > n or j > m then
                len[i][j] = 0
            elseif a[lo + i - 1] == b[lo + j - 1] then
                len[i][j] = len[i + 1][j + 1] + 1
            else
                local down, right = len[i + 1][j], len[i][j + 1]
                len[i][j] = down >= right and down or right
            end
        end
    end
    local i, j = 1, 1
    while i <= n and j <= m do
        local x, y = a[lo + i - 1], b[lo + j - 1]
        if x == y then
            out[#out + 1] = { op = "same", text = x }
            i, j = i + 1, j + 1
        elseif len[i + 1][j] >= len[i][j + 1] then
            out[#out + 1] = { op = "remove", text = x }
            i = i + 1
        else
            out[#out + 1] = { op = "add", text = y }
            j = j + 1
        end
    end
    for k = i, n do
        out[#out + 1] = { op = "remove", text = a[lo + k - 1] }
    end
    for k = j, m do
        out[#out + 1] = { op = "add", text = b[lo + k - 1] }
    end
end

function Diff.Lines(oldText, newText)
    local a, b = split(oldText), split(newText)
    local out = {}
    -- the lines both start with
    local lo = 1
    while lo <= #a and lo <= #b and a[lo] == b[lo] do
        out[#out + 1] = { op = "same", text = a[lo] }
        lo = lo + 1
    end
    -- the lines both end with
    local ahi, bhi = #a, #b
    while ahi >= lo and bhi >= lo and a[ahi] == b[bhi] do
        ahi, bhi = ahi - 1, bhi - 1
    end
    middle(a, b, lo, ahi, bhi, out)
    for k = ahi + 1, #a do
        out[#out + 1] = { op = "same", text = a[k] }
    end
    local added, removed = 0, 0
    for _, line in ipairs(out) do
        if line.op == "add" then
            added = added + 1
        elseif line.op == "remove" then
            removed = removed + 1
        end
    end
    return out, added, removed
end

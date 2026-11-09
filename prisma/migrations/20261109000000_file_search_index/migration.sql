-- Search index: what Flare read from each file, plus the work queue for it.
CREATE TYPE "SearchIndexStatus" AS ENUM ('PENDING', 'PROCESSING', 'INDEXED', 'EMPTY', 'FAILED', 'SKIPPED', 'UNSUPPORTED');

CREATE TABLE "FileSearchIndex" (
    "fileId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "status" "SearchIndexStatus" NOT NULL DEFAULT 'PENDING',
    "source" TEXT,
    "content" TEXT,
    "entries" TEXT,
    "vector" tsvector,
    "reason" TEXT,
    "attempts" INTEGER NOT NULL DEFAULT 0,
    "version" INTEGER NOT NULL DEFAULT 0,
    "availableAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "leaseId" TEXT,
    "leaseUntil" TIMESTAMP(3),
    "indexedAt" TIMESTAMP(3),
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "FileSearchIndex_pkey" PRIMARY KEY ("fileId")
);

CREATE INDEX "FileSearchIndex_status_availableAt_idx" ON "FileSearchIndex"("status", "availableAt");
CREATE INDEX "FileSearchIndex_userId_status_idx" ON "FileSearchIndex"("userId", "status");
CREATE INDEX "FileSearchIndex_vector_idx" ON "FileSearchIndex" USING GIN ("vector");

ALTER TABLE "FileSearchIndex" ADD CONSTRAINT "FileSearchIndex_fileId_fkey" FOREIGN KEY ("fileId") REFERENCES "File"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Lower case without accents, for live name, tag and folder matching. The
-- characters are exactly those whose compatibility decomposition is one ASCII
-- letter plus marks, so this agrees with lib/search/text.ts foldText(). No
-- extension (such as unaccent) is needed.
CREATE FUNCTION flare_search_fold(value text) RETURNS text
LANGUAGE sql IMMUTABLE STRICT PARALLEL SAFE
AS $fold$
  SELECT translate(lower(value), 'ÀÁÂÃÄÅÇÈÉÊËÌÍÎÏÑÒÓÔÕÖÙÚÛÜÝàáâãäåçèéêëìíîïñòóôõöùúûüýÿĀāĂăĄąĆćĈĉĊċČčĎďĒēĔĕĖėĘęĚěĜĝĞğĠġĢģĤĥĨĩĪīĬĭĮįİĴĵĶķĹĺĻļĽľŃńŅņŇňŌōŎŏŐőŔŕŖŗŘřŚśŜŝŞşŠšŢţŤťŨũŪūŬŭŮůŰűŲųŴŵŶŷŸŹźŻżŽžſƠơƯưǍǎǏǐǑǒǓǔǕǖǗǘǙǚǛǜǞǟǠǡǦǧǨǩǪǫǬǭǰǴǵǸǹǺǻȀȁȂȃȄȅȆȇȈȉȊȋȌȍȎȏȐȑȒȓȔȕȖȗȘșȚțȞȟȦȧȨȩȪȫȬȭȮȯȰȱȲȳḀḁḂḃḄḅḆḇḈḉḊḋḌḍḎḏḐḑḒḓḔḕḖḗḘḙḚḛḜḝḞḟḠḡḢḣḤḥḦḧḨḩḪḫḬḭḮḯḰḱḲḳḴḵḶḷḸḹḺḻḼḽḾḿṀṁṂṃṄṅṆṇṈṉṊṋṌṍṎṏṐṑṒṓṔṕṖṗṘṙṚṛṜṝṞṟṠṡṢṣṤṥṦṧṨṩṪṫṬṭṮṯṰṱṲṳṴṵṶṷṸṹṺṻṼṽṾṿẀẁẂẃẄẅẆẇẈẉẊẋẌẍẎẏẐẑẒẓẔẕẖẗẘẙẛẠạẢảẤấẦầẨẩẪẫẬậẮắẰằẲẳẴẵẶặẸẹẺẻẼẽẾếỀềỂểỄễỆệỈỉỊịỌọỎỏỐốỒồỔổỖỗỘộỚớỜờỞởỠỡỢợỤụỦủỨứỪừỬửỮữỰựỲỳỴỵỶỷỸỹ', 'aaaaaaceeeeiiiinooooouuuuyaaaaaaceeeeiiiinooooouuuuyyaaaaaaccccccccddeeeeeeeeeegggggggghhiiiiiiiiijjkkllllllnnnnnnoooooorrrrrrssssssssttttuuuuuuuuuuuuwwyyyzzzzzzsoouuaaiioouuuuuuuuuuaaaaggkkoooojggnnaaaaaaeeeeiiiioooorrrruuuusstthhaaeeooooooooyyaabbbbbbccddddddddddeeeeeeeeeeffgghhhhhhhhhhiiiikkkkkkllllllllmmmmmmnnnnnnnnoooooooopppprrrrrrrrssssssssssttttttttuuuuuuuuuuvvvvwwwwwwwwwwxxxxyyzzzzzzhtwysaaaaaaaaaaaaaaaaaaaaaaaaeeeeeeeeeeeeeeeeiiiioooooooooooooooooooooooouuuuuuuuuuuuuuyyyyyyyy')
$fold$;

-- Every existing file is read in the background, newest first. Images that
-- already have OCR text reuse it instead of being recognized again.
INSERT INTO "FileSearchIndex" ("fileId", "userId", "availableAt", "updatedAt")
SELECT id, "userId", "uploadedAt", CURRENT_TIMESTAMP FROM "File";

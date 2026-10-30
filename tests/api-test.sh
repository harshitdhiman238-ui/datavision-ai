#!/usr/bin/env bash
# DataVision AI — API smoke test. Run with the server up on $BASE (default http://localhost:3000).
set -u
BASE="${BASE:-http://localhost:3000}"
JAR=$(mktemp); JAR2=$(mktemp); ADMIN=$(mktemp)
PASS=0; FAIL=0
chk(){ local name="$1" cond="$2"; if [ "$cond" = "1" ]; then PASS=$((PASS+1)); echo "  ✔ $name"; else FAIL=$((FAIL+1)); echo "  ✘ FAIL: $name"; fi; }
json(){ python3 -c "import sys,json;d=json.load(sys.stdin);print(d$1)" 2>/dev/null; }

echo "== health =="
H=$(curl -s $BASE/api/health)
chk "health ok" "$([ "$(echo $H|json "['ok']")" = "True" ] && echo 1 || echo 0)"

echo "== demo endpoints (public) =="
chk "demo kpis" "$([ -n "$(curl -s $BASE/api/demo/kpis|json "['kpis'][0]['label']")" ] && echo 1 || echo 0)"
chk "demo ask" "$(curl -s -X POST $BASE/api/demo/ask -H 'Content-Type: application/json' -d '{"question":"find duplicate rows"}'|grep -qc 'duplicate' && echo 1 || echo 0)"

echo "== validation =="
R=$(curl -s -X POST $BASE/api/auth/register -H 'Content-Type: application/json' -d '{"name":"T","email":"bad","password":"short"}')
chk "register rejects bad input" "$(echo $R|grep -qc error && echo 1 || echo 0)"

echo "== register/login =="
EM="user$RANDOM@test.com"
R=$(curl -s -c $JAR -X POST $BASE/api/auth/register -H 'Content-Type: application/json' -d "{\"name\":\"Test User\",\"email\":\"$EM\",\"password\":\"test1234\"}")
chk "register ok" "$([ "$(echo $R|json "['user']['email']")" = "$EM" ] && echo 1 || echo 0)"
R=$(curl -s -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d "{\"email\":\"$EM\",\"password\":\"wrong999\"}")
chk "wrong password rejected" "$(echo $R|grep -qc 'Incorrect' && echo 1 || echo 0)"
chk "unauthenticated projects blocked" "$([ "$(curl -s -o /dev/null -w '%{http_code}' $BASE/api/projects)" = "401" ] && echo 1 || echo 0)"

echo "== upload =="
R=$(curl -s -b $JAR -F "file=@sample-data/sample_sales_data.csv" -F "name=Smoke Test" $BASE/api/projects/upload)
PID=$(echo $R|json "['project']['id']")
chk "upload parsed (427 rows)" "$([ "$(echo $R|json "['project']['row_count']")" = "427" ] && echo 1 || echo 0)"
echo "bad content" > /tmp/bad.txt
chk "bad extension rejected" "$(curl -s -b $JAR -F "file=@/tmp/bad.txt" $BASE/api/projects/upload|grep -qc 'error' && echo 1 || echo 0)"

echo "== profiling =="
R=$(curl -s -b $JAR $BASE/api/projects/$PID/profile)
chk "duplicates found" "$([ "$(echo $R|json "['profile']['duplicateRows']")" = "7" ] && echo 1 || echo 0)"
chk "missing found" "$([ "$(echo $R|json "['profile']['totalMissing']")" -gt "0" ] && echo 1 || echo 0)"
chk "mixed dates found" "$([ "$(echo $R|json "['profile']['mixedDateColumns'][0]['column']")" = "Order Date" ] && echo 1 || echo 0)"

echo "== KPI correctness vs source =="
EXP=$(python3 - <<PY
import csv
tot=0
with open('sample-data/sample_sales_data.csv') as f:
    for r in csv.DictReader(f): tot+=float(r['Revenue'])
print(int(tot))
PY
)
GOT=$(curl -s -b $JAR $BASE/api/projects/$PID/kpis|python3 -c "import sys,json;d=json.load(sys.stdin);print(int([k for k in d['kpis'] if k['id']=='revenue'][0]['value']))")
chk "Total Revenue matches CSV sum ($EXP)" "$([ "$GOT" = "$EXP" ] && echo 1 || echo 0)"

echo "== cleaning =="
OPS='{"ops":{"removeDuplicates":true,"trimWhitespace":true,"standardizeDates":["Order Date"],"missing":{"Discount":{"strategy":"fill_mean"}}}}'
R=$(curl -s -b $JAR -X POST $BASE/api/projects/$PID/clean/preview -H 'Content-Type: application/json' -d "$OPS")
chk "preview: 420 rows after" "$([ "$(echo $R|json "['after']['rows']")" = "420" ] && echo 1 || echo 0)"
chk "preview: no dupes after" "$([ "$(echo $R|json "['after']['profile']['duplicateRows']")" = "0" ] && echo 1 || echo 0)"
R=$(curl -s -b $JAR -X POST $BASE/api/projects/$PID/clean/apply -H 'Content-Type: application/json' -d "$OPS")
chk "apply ok" "$([ "$(echo $R|json "['rowCount']")" = "420" ] && echo 1 || echo 0)"
R=$(curl -s -b $JAR $BASE/api/projects/$PID/data?limit=1)
chk "active variant = cleaned" "$([ "$(echo $R|json "['variant']")" = "cleaned" ] && echo 1 || echo 0)"
R=$(curl -s -b $JAR -X POST $BASE/api/projects/$PID/clean/revert -H 'Content-Type: application/json' -d '{}')
chk "revert ok" "$([ "$(echo $R|json "['ok']")" = "True" ] && echo 1 || echo 0)"
R=$(curl -s -b $JAR $BASE/api/projects/$PID/data?limit=1)
chk "back to original (427)" "$([ "$(echo $R|json "['total']")" = "427" ] && echo 1 || echo 0)"

echo "== analysis / insights / ask =="
chk "analysis has numericStats" "$([ -n "$(curl -s -b $JAR $BASE/api/projects/$PID/analysis|json "['analysis']['numericStats']['Revenue']['sum']")" ] && echo 1 || echo 0)"
R=$(curl -s -b $JAR $BASE/api/projects/$PID/insights)
chk "insights rule-based" "$([ "$(echo $R|json "['engine']")" = "rule-based" ] && echo 1 || echo 0)"
R=$(curl -s -b $JAR -X POST $BASE/api/projects/$PID/ask -H 'Content-Type: application/json' -d '{"question":"Which product has the highest revenue?"}')
chk "ask returns answer+method" "$([ -n "$(echo $R|json "['method']")" ] && echo 1 || echo 0)"

echo "== exports =="
chk "csv export" "$(curl -s -b $JAR $BASE/api/projects/$PID/export/csv|head -1|grep -qc 'Order ID' && echo 1 || echo 0)"
chk "xlsx export (magic bytes)" "$([ "$(curl -s -b $JAR $BASE/api/projects/$PID/export/xlsx|head -c2)" = "PK" ] && echo 1 || echo 0)"
chk "report-data" "$([ -n "$(curl -s -b $JAR $BASE/api/projects/$PID/report-data|json "['kpis']['kpis'][0]['label']")" ] && echo 1 || echo 0)"

echo "== ownership & admin access =="
EM2="user$RANDOM@test.com"
curl -s -c $JAR2 -X POST $BASE/api/auth/register -H 'Content-Type: application/json' -d "{\"name\":\"Other User\",\"email\":\"$EM2\",\"password\":\"test1234\"}" >/dev/null
chk "other user blocked from project (403)" "$([ "$(curl -s -b $JAR2 -o /dev/null -w '%{http_code}' $BASE/api/projects/$PID/data)" = "403" ] && echo 1 || echo 0)"
chk "normal user blocked from admin (403)" "$([ "$(curl -s -b $JAR -o /dev/null -w '%{http_code}' $BASE/api/admin/stats)" = "403" ] && echo 1 || echo 0)"
curl -s -c $ADMIN -X POST $BASE/api/auth/login -H 'Content-Type: application/json' -d '{"email":"admin@datavision.local","password":"Admin@1234"}' >/dev/null
R=$(curl -s -b $ADMIN $BASE/api/admin/stats)
chk "admin stats ok" "$([ -n "$(echo $R|json "['users']")" ] && echo 1 || echo 0)"
chk "admin users list has no password field" "$(curl -s -b $ADMIN $BASE/api/admin/users|grep -qc password && echo 0 || echo 1)"

echo "== project management =="
R=$(curl -s -b $JAR -X PUT $BASE/api/projects/$PID -H 'Content-Type: application/json' -d '{"name":"Renamed Project"}')
chk "rename" "$([ "$(echo $R|json "['project']['name']")" = "Renamed Project" ] && echo 1 || echo 0)"
R=$(curl -s -b $JAR -X DELETE $BASE/api/projects/$PID)
chk "delete" "$([ "$(echo $R|json "['ok']")" = "True" ] && echo 1 || echo 0)"
chk "deleted project gone (404)" "$([ "$(curl -s -b $JAR -o /dev/null -w '%{http_code}' $BASE/api/projects/$PID)" = "404" ] && echo 1 || echo 0)"

echo ""
echo "RESULT: $PASS passed, $FAIL failed"
[ $FAIL -eq 0 ]

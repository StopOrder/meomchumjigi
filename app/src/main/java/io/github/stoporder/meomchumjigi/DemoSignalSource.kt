package io.github.stoporder.meomchumjigi

import android.os.Handler
import android.os.Looper

/**
 * 시연용 신호. Pleos 차량 서비스가 없는 기기(일반 안드로이드 기기·일반 에뮬레이터)에서 쓴다.
 * 정해진 각본대로 신호를 흘려 보낼 뿐이고, 판정은 화면 쪽 로직이 실제로 계산한다.
 * 각본: 고속도로 주행 → 엔진 경고등·출력 제한 → 갓길 정차 → 한 명씩 하차 → 문 닫힘.
 */
class DemoSignalSource : VehicleSignalSource {
    override val label = "시연 신호 · 정해진 각본 (실차 아님)"
    override val isDemo = true

    private val handler = Handler(Looper.getMainLooper())

    override fun start(sink: SignalSink) {
        stop()
        fun at(ms: Long, block: () -> Unit) = handler.postDelayed(block, ms)

        at(300) { listOf(0, 1, 2, 4).forEach { sink.onSeat(it, true) } }   // 운전자 + 가족 3명
        at(1_500) { sink.onSpeed(100, true) }
        at(6_000) { sink.onTelltales(listOf("엔진 경고등", "출력 제한 경고")) }
        at(6_500) { sink.onSpeed(40, true) }
        at(9_500) { sink.onSpeed(0, true) }            // 갓길 정차 → 대피 안내 시작
        at(21_000) { sink.onDoor("fr", true) }
        at(24_000) { sink.onSeat(1, false) }           // 조수석
        at(28_000) { sink.onDoor("rr", true) }
        at(31_000) { sink.onSeat(2, false) }           // 뒷좌석 왼쪽 (아이)
        at(40_000) { sink.onSeat(4, false) }           // 뒷좌석 오른쪽 (할머니)
        at(43_000) { sink.onDoor("rr", false) }
        at(48_000) { sink.onSeat(0, false) }           // 운전자
        at(52_000) { sink.onDoor("fr", false) }        // 전원 하차 판정
    }

    override fun stop() = handler.removeCallbacksAndMessages(null)

    override fun setEvacLamps(on: Boolean) { /* 시연에서는 화면 표시만 바뀐다 */ }
}
